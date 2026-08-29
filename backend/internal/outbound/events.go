package outbound

import (
	"time"

	"garuda/backend/internal/model"
	"garuda/backend/internal/security"
)

// endedConversationWindow bounds how far back the ended-conversation scan looks.
// A conversation that has been silent longer than this is never a candidate
// again, which is what makes the "already ended" set safe to prune and therefore
// bounded. The cost is that a scan that has been stopped for more than a day
// misses the ended events for that gap; the conversations themselves are all
// still in the product, and losing a day of a fire-and-forget notification is a
// far better failure than a set that grows forever.
const endedConversationWindow = 24 * time.Hour

// Scan turns state changes into events. It is the whole event source.
//
// WHY POLLING AND NOT A CALL FROM THE HANDLERS. The natural design is a line in
// the lead handler that says "also fire a webhook". That line would sit on the
// widget request path, where a customer's slow endpoint becomes a slow chat
// widget for a visitor, and where a process restart between the write and the
// send loses the event with nothing to replay it from. Reading the committed
// state on a short interval instead means the trigger is the durable fact, not a
// function call: nothing is lost across a restart, and the request that created
// the lead has already returned before this code runs at all. The cost is a few
// seconds of latency, which no CRM notices.
//
// Scan is called from a single goroutine -- the worker, or a test -- and the
// scanMutex enforces that so two passes can never emit the same event twice.
func (r *Registry) Scan() {
	if r.initError != nil || r.options.Store == nil {
		return
	}
	r.scanMutex.Lock()
	defer r.scanMutex.Unlock()

	now := r.now()
	r.mutex.Lock()
	subscribedAccounts := map[string]bool{}
	for _, endpoint := range r.state.Endpoints {
		if endpoint.Enabled {
			subscribedAccounts[endpoint.AccountID] = true
		}
	}
	leadWatermark := r.state.LeadWatermark
	startWatermark := r.state.ConversationStartWatermark
	alreadyEnded := make(map[string]time.Time, len(r.state.EndedConversations))
	for sessionID, lastSeenAt := range r.state.EndedConversations {
		alreadyEnded[sessionID] = lastSeenAt
	}
	r.mutex.Unlock()

	nextLeadWatermark := leadWatermark
	nextStartWatermark := startWatermark
	newlyEnded := map[string]time.Time{}
	var events []Event

	_ = r.options.Store.View(func(state *model.State) error {
		// Everything taken out of this callback is either a scalar or a value
		// produced by a Clone helper. A map or slice header copied straight out of
		// live state would still be read after the read lock is released, and a map
		// read racing a write is fatal to the process, not recoverable.
		for _, lead := range state.Leads {
			if leadWatermark.seen(lead.ID, lead.CreatedAt) {
				continue
			}
			nextLeadWatermark = nextLeadWatermark.advance(lead.ID, lead.CreatedAt)
			if !subscribedAccounts[lead.AccountID] {
				continue
			}
			events = append(events, Event{
				Type:      EventLeadCreated,
				AccountID: lead.AccountID,
				CreatedAt: lead.CreatedAt,
				Data:      map[string]any{"lead": leadPayload(lead.Clone())},
			})
		}

		endedCandidates := map[string]model.Session{}
		for _, session := range state.Sessions {
			if session.StartedAt == nil {
				continue
			}
			startedAt := *session.StartedAt
			if !startWatermark.seen(session.ID, startedAt) {
				nextStartWatermark = nextStartWatermark.advance(session.ID, startedAt)
				if subscribedAccounts[session.AccountID] {
					events = append(events, Event{
						Type:      EventConversationStarted,
						AccountID: session.AccountID,
						CreatedAt: startedAt,
						Data:      map[string]any{"conversation": conversationPayload(session, startedAt, 0)},
					})
				}
			}
			if !subscribedAccounts[session.AccountID] {
				continue
			}
			if _, ended := alreadyEnded[session.ID]; ended {
				continue
			}
			idleFor := now.Sub(session.LastSeenAt)
			if idleFor < r.options.IdleTimeout || idleFor >= endedConversationWindow {
				continue
			}
			endedCandidates[session.ID] = session
		}

		if len(endedCandidates) > 0 {
			messageCounts := map[string]int{}
			for _, message := range state.Messages {
				if _, candidate := endedCandidates[message.SessionID]; candidate {
					messageCounts[message.SessionID]++
				}
			}
			for sessionID, session := range endedCandidates {
				startedAt := *session.StartedAt
				payload := conversationPayload(session, startedAt, messageCounts[sessionID])
				payload["ended_at"] = session.LastSeenAt.UTC()
				payload["duration_seconds"] = int(session.LastSeenAt.Sub(startedAt).Seconds())
				events = append(events, Event{
					Type:      EventConversationEnded,
					AccountID: session.AccountID,
					CreatedAt: session.LastSeenAt,
					Data:      map[string]any{"conversation": payload},
				})
				newlyEnded[sessionID] = session.LastSeenAt
			}
		}
		return nil
	})

	// Enqueue BEFORE advancing the watermark. A crash between the two repeats an
	// event, which every webhook consumer is expected to handle -- that is what
	// Garuda-Event-Id is for -- whereas the other order silently drops it.
	for index := range events {
		identifier, err := security.RandomToken(12)
		if err != nil {
			continue
		}
		events[index].ID = "evt_" + identifier
		r.Enqueue(events[index])
	}

	r.mutex.Lock()
	r.state.LeadWatermark = nextLeadWatermark
	r.state.ConversationStartWatermark = nextStartWatermark
	for sessionID, lastSeenAt := range newlyEnded {
		r.state.EndedConversations[sessionID] = lastSeenAt
	}
	for sessionID, lastSeenAt := range r.state.EndedConversations {
		if now.Sub(lastSeenAt) >= endedConversationWindow {
			delete(r.state.EndedConversations, sessionID)
		}
	}
	if err := r.save(); err != nil {
		r.options.Logger.Error("outbound scan position could not be persisted", "error", err)
	}
	r.mutex.Unlock()
}

// leadPayload is the lead as a CRM wants it.
//
// This deliberately carries the contact details. House rule seven forbids
// LOGGING a visitor's email or phone number and this code never does -- the
// delivery log records the event name, the status, the attempt count and the
// error, and nothing else. But a CRM integration whose payload omitted the
// contact would be pointless, and the customer configured this endpoint
// themselves, over TLS, to a destination they own. That is a disclosure the
// customer asked for, not one we made on their behalf.
func leadPayload(lead model.Lead) map[string]any {
	payload := map[string]any{
		"id":         lead.ID,
		"agent_id":   lead.AgentID,
		"session_id": lead.SessionID,
		"status":     lead.Status,
		"source":     lead.Source,
		"created_at": lead.CreatedAt.UTC(),
	}
	addWhenSet(payload, "name", lead.Name)
	addWhenSet(payload, "email", lead.Email)
	addWhenSet(payload, "phone", lead.Phone)
	addWhenSet(payload, "company", lead.Company)
	addWhenSet(payload, "notes", lead.Notes)
	if len(lead.Metadata) > 0 {
		payload["metadata"] = lead.Metadata
	}
	return payload
}

// conversationPayload describes a conversation without any of its content. The
// transcript is deliberately absent: a CRM needs to know a conversation happened
// and where, and shipping every visitor's words to a third party by default is
// not a decision to make quietly on a customer's behalf.
func conversationPayload(session model.Session, startedAt time.Time, messageCount int) map[string]any {
	payload := map[string]any{
		"id":         session.ID,
		"agent_id":   session.AgentID,
		"visitor_id": session.VisitorID,
		"started_at": startedAt.UTC(),
	}
	addWhenSet(payload, "page_url", session.PageURL)
	addWhenSet(payload, "page_title", session.PageTitle)
	addWhenSet(payload, "referrer", session.Referrer)
	addWhenSet(payload, "locale", session.Locale)
	addWhenSet(payload, "origin", session.Origin)
	if messageCount > 0 {
		payload["message_count"] = messageCount
	}
	return payload
}

func addWhenSet(payload map[string]any, key, value string) {
	if value != "" {
		payload[key] = value
	}
}
