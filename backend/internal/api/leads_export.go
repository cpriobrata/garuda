package api

import (
	"encoding/csv"
	"errors"
	"net/http"
	"net/mail"
	"sort"
	"strings"
	"time"

	"garuda/backend/internal/model"
)

// manualLeadSource marks a lead somebody typed into the portal by hand.
//
// It must never read as "widget". A widget lead only exists because a visitor
// ticked a consent box and this service recorded the evidence beside it, and the
// privacy notice the product shows customers rests on exactly that. A lead an
// operator transcribed from a phone call carries no such evidence, so it gets its
// own source word and its metadata says plainly that consent was not collected
// here. Anything counting consented captures can then filter on the source
// instead of assuming every stored lead came through the consent gate.
const manualLeadSource = "manual"

// validLeadStatus holds the lead workflow vocabulary. The list route filters on
// it, the update route validates against it, and manual add and export both reuse
// it, so the four cannot drift into accepting different words for one state.
func validLeadStatus(status string) bool {
	switch status {
	case "new", "qualified", "contacted", "converted", "disqualified":
		return true
	}
	return false
}

// leadExportColumns is the header row and the order every data row follows.
var leadExportColumns = []string{
	"id", "created_at", "updated_at", "name", "email", "phone",
	"company", "status", "source", "agent_id", "notes",
}

// leadExportFlushInterval bounds how many rows may sit in the writer's buffer
// before they are pushed towards the client. The response is written row by row
// rather than assembled into one string, so a workspace with a large lead table
// does not cost a proportional allocation on every export.
const leadExportFlushInterval = 200

// csvSafeCell defuses spreadsheet formula injection.
//
// A lead's name, company and notes are text somebody else typed into a website
// widget. Excel, LibreOffice and Google Sheets all evaluate a cell whose first
// character is =, +, - or @, or a tab or carriage return, the moment the customer
// opens the download -- which is how a captured lead turns into command execution
// on the customer's own machine. A leading single quote makes the spreadsheet
// treat the whole cell as literal text. The prefix goes on before the CSV writer
// runs, so quoting and quote-doubling still happen around it and the guard cannot
// be escaped out of.
func csvSafeCell(value string) string {
	if value == "" {
		return value
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	}
	return value
}

// leadExportFilename builds the download name. Both halves are ours: the status
// has already been checked against the fixed vocabulary above and the date is
// formatted rather than copied from input, so nothing here can carry a quote, a
// path separator or a newline into the Content-Disposition header.
func leadExportFilename(status string, now time.Time) string {
	name := "garuda-leads"
	if status != "" {
		name += "-" + status
	}
	return name + "-" + now.Format("2006-01-02") + ".csv"
}

// exportLeads streams the account's leads as CSV, honouring the same filters the
// list route accepts so the file matches what the customer is looking at.
func (s *Server) exportLeads(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	agentID := strings.TrimSpace(r.URL.Query().Get("agent_id"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))
	// Validate before a single byte of the body is written. Once the CSV headers
	// are on the wire the response can no longer become an error envelope, and a
	// misspelled status would otherwise download as an empty file that looks like
	// "this account has no qualified leads".
	if status != "" && !validLeadStatus(status) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Lead status is invalid", nil)
		return
	}

	items := make([]model.Lead, 0)
	_ = s.store.View(func(state *model.State) error {
		for index := range state.Leads {
			lead := state.Leads[index]
			if lead.AccountID != identity.AccountID || (agentID != "" && lead.AgentID != agentID) || (status != "" && lead.Status != status) {
				continue
			}
			if query != "" && !strings.Contains(strings.ToLower(strings.Join([]string{lead.Name, lead.Email, lead.Phone, lead.Company}, " ")), query) {
				continue
			}
			// The rows are encoded long after this callback returns, so each one has
			// to stop sharing its metadata map with live state before it leaves.
			items = append(items, lead.Clone())
		}
		return nil
	})
	// Newest first, matching the list route the customer exported from.
	sort.SliceStable(items, func(first, second int) bool { return items[first].CreatedAt.After(items[second].CreatedAt) })

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+leadExportFilename(status, time.Now().UTC())+`"`)
	w.Header().Set("Cache-Control", "no-store")
	// This body is a file the browser saves rather than renders, and it carries
	// contact details. Sniffing it into something the browser executes is exactly
	// the outcome to prevent.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	// Excel reads a mark-less CSV in the machine's legacy code page, which turns
	// every accented name in the file into mojibake. The byte order mark tells it
	// the file is UTF-8; every other reader skips it.
	_, _ = w.Write([]byte("\xef\xbb\xbf"))

	writer := csv.NewWriter(w)
	if err := writer.Write(leadExportColumns); err != nil {
		return
	}
	writer.Flush()
	flushResponse(w)
	for index, lead := range items {
		row := []string{
			lead.ID,
			lead.CreatedAt.UTC().Format(time.RFC3339),
			lead.UpdatedAt.UTC().Format(time.RFC3339),
			csvSafeCell(lead.Name),
			csvSafeCell(lead.Email),
			csvSafeCell(lead.Phone),
			csvSafeCell(lead.Company),
			lead.Status,
			lead.Source,
			lead.AgentID,
			csvSafeCell(lead.Notes),
		}
		if err := writer.Write(row); err != nil {
			// The client hung up mid-download. There is nothing left to say to it,
			// and nothing worth logging: every field of the row is contact detail.
			return
		}
		if (index+1)%leadExportFlushInterval == 0 {
			writer.Flush()
			flushResponse(w)
		}
	}
	writer.Flush()
	flushResponse(w)
}

// flushResponse pushes whatever is buffered towards the client when the writer
// supports it, so a long export arrives progressively instead of landing in one
// piece at the end.
func flushResponse(w http.ResponseWriter) {
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

type createLeadRequest struct {
	AgentID string `json:"agent_id,omitempty"`
	Name    string `json:"name,omitempty"`
	Email   string `json:"email,omitempty"`
	Phone   string `json:"phone,omitempty"`
	Company string `json:"company,omitempty"`
	Status  string `json:"status,omitempty"`
	Notes   string `json:"notes,omitempty"`
}

// createLead adds a lead by hand from the portal.
//
// The contact-detail rules are the widget's rules: the same normalisation, the
// same "an email address or a phone number is required", the same length limits.
// A lead typed here must be no less trustworthy as a record than one the widget
// captured -- only differently sourced.
func (s *Server) createLead(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var input createLeadRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	name := strings.TrimSpace(input.Name)
	company := strings.TrimSpace(input.Company)
	notes := strings.TrimSpace(input.Notes)
	email := normalizeEmail(input.Email)
	submittedPhone := strings.TrimSpace(input.Phone)
	phone := normalizePhone(submittedPhone)
	// normalizePhone answers "" both for "nothing was sent" and for "what was sent
	// is not a phone number". Telling those apart here is the difference between a
	// message that names the broken field and one that claims the operator left it
	// blank when they did not.
	if submittedPhone != "" && phone == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Phone number is invalid", map[string]string{"phone": "invalid"})
		return
	}
	if email == "" && phone == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "An email address or phone number is required", nil)
		return
	}
	if email != "" {
		if _, err := mail.ParseAddress(email); err != nil || len(email) > 254 {
			s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Email address is invalid", map[string]string{"email": "invalid"})
			return
		}
	}
	if phone != "" && len(phone) < 7 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Phone number is invalid", map[string]string{"phone": "invalid"})
		return
	}
	if len(name) > 160 || len(company) > 160 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Lead fields are too long", nil)
		return
	}
	if len(notes) > 4_000 {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Notes must not exceed 4,000 characters", nil)
		return
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = "new"
	}
	if !validLeadStatus(status) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "Lead status is invalid", nil)
		return
	}

	now := time.Now().UTC()
	lead := model.Lead{
		ID: newID("lead_"), AccountID: identity.AccountID, Name: name, Email: email, Phone: phone,
		Company: company, Status: status, Source: manualLeadSource, Notes: notes,
		// No consent evidence, because none was given to this service. Saying so
		// outright beats leaving the key absent: a reader that treats a missing
		// consent key as "probably fine" is exactly the mistake worth blocking.
		Metadata:  map[string]string{"consent": "not_collected", "added_by_user_id": identity.UserID},
		CreatedAt: now, UpdatedAt: now,
	}
	requestedAgentID := strings.TrimSpace(input.AgentID)
	err := s.store.Update(func(state *model.State) error {
		if requestedAgentID != "" {
			// The body named the agent, so the body is a request, not authority. The
			// agent is resolved within the authenticated account, and an id belonging
			// to another workspace is indistinguishable from one that does not exist.
			agent, ok := findAgent(state, identity.AccountID, requestedAgentID)
			if !ok || agent.Status == "archived" {
				return errors.New("agent not found")
			}
			lead.AgentID = agent.ID
		}
		state.Leads = append(state.Leads, lead)
		return nil
	})
	if err != nil {
		if err.Error() == "agent not found" {
			s.writeError(w, r, http.StatusNotFound, "agent_not_found", "Agent not found", nil)
			return
		}
		s.storageFailure(w, r, err)
		return
	}
	// The appended lead shares its metadata map with live state, and this response
	// is encoded after the write lock is gone.
	s.writeData(w, http.StatusCreated, lead.Clone())
}
