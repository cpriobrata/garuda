package api

import (
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"garuda/backend/internal/model"
)

// Team replies: the owner types into their inbox and the visitor sees it in the
// widget, in the same conversation, without a new channel.
//
// WHY THE REPLY IS STORED WITH role "assistant". The widget already renders
// assistant turns and the model already reads them as its own prior context, so
// a human answer arrives looking like part of the same conversation, and the
// model does not contradict what a person just said. Who wrote it is recorded in
// metadata rather than in the role, because changing the role would mean
// touching every consumer of a transcript to teach it a third kind of speaker.
//
// WHY THE VISITOR POLLS. There is no socket and no push channel here. A widget
// on somebody else's website is loaded and unloaded constantly, and a connection
// held open per open panel is a cost this service does not need to carry to
// deliver a message a few seconds later. The widget asks for anything after the
// last message it holds, and only while its panel is open.

const (
	// Counted in RUNES, not bytes. Go's len() on a string is a byte count, and a
	// 4,000-byte cap is barely 1,300 characters of Hindi or Chinese -- it would
	// reject an ordinary reply in most of the languages this product serves.
	maxTeamReplyLength = 4000
	// widgetPollLimit bounds one poll response. A visitor who left a tab open
	// overnight comes back to the tail of the conversation, not to a payload
	// proportional to how long they were away.
	widgetPollLimit = 20

	// pollGraceWindow is how far BEHIND the cursor a poll also looks, and it
	// exists because a cursor cannot express what the widget actually holds.
	//
	// An operator types a reply while the model is generating. The reply is
	// stored first; the model's answer is stored second with a later timestamp;
	// the widget, which appended that answer itself, polls with it as the cursor.
	// Anything strictly after that position skips the operator's reply forever --
	// losing the one message a person actually typed.
	//
	// Two minutes comfortably covers a generation, and the cost is a handful of
	// messages the widget already discards by id. Correctness here is worth more
	// than the bytes.
	pollGraceWindow = 2 * time.Minute
)

type teamReplyRequest struct {
	Content string `json:"content"`
}

// postTeamReply appends the owner's reply to a conversation they own.
func (s *Server) postTeamReply(w http.ResponseWriter, r *http.Request) {
	identity := identityFrom(r.Context())
	var input teamReplyRequest
	if !s.decodeJSON(w, r, &input) {
		return
	}
	content := strings.TrimSpace(input.Content)
	if content == "" || utf8.RuneCountInString(content) > maxTeamReplyLength {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "A reply must contain between 1 and 4,000 characters", map[string]string{
			"content": "must contain between 1 and 4,000 characters",
		})
		return
	}

	sessionID := r.PathValue("sessionID")
	now := time.Now().UTC()
	var reply model.Message
	found := false
	err := s.store.Update(func(state *model.State) error {
		var session *model.Session
		for index := range state.Sessions {
			// The account check is the tenant boundary. A session id from another
			// workspace must look exactly like one that does not exist.
			if state.Sessions[index].ID == sessionID && state.Sessions[index].AccountID == identity.AccountID {
				session = &state.Sessions[index]
				break
			}
		}
		if session == nil {
			return nil
		}
		found = true
		reply = model.Message{
			ID: newID("msg_"), AccountID: session.AccountID, AgentID: session.AgentID, SessionID: session.ID,
			VisitorID: session.VisitorID, Role: "assistant", Content: content,
			Metadata:  map[string]any{"author": "operator", "user_id": identity.UserID},
			CreatedAt: now,
		}
		state.Messages = append(state.Messages, reply)
		session.UpdatedAt = now
		return nil
	})
	if err != nil {
		s.storageFailure(w, r, err)
		return
	}
	if !found {
		s.writeError(w, r, http.StatusNotFound, "conversation_not_found", "Conversation not found", nil)
		return
	}
	s.writeData(w, http.StatusCreated, map[string]any{"message": reply})
}

// pollWidgetMessages returns the conversation's messages that the visitor's
// widget does not already hold.
//
// The cursor is a message id rather than a timestamp. Two messages written in
// the same millisecond are indistinguishable by time, and a cursor that cannot
// distinguish them either repeats one or drops one; an id that is found in the
// ordered transcript cannot do either. An unknown id -- one from a conversation
// that was reset, say -- falls back to the tail rather than replaying
// everything, because the alternative is a visitor whose panel suddenly refills
// with a conversation they thought they had left behind.
func (s *Server) pollWidgetMessages(w http.ResponseWriter, r *http.Request) {
	session, authorized := s.authorizeWidgetSession(r)
	if !authorized {
		s.writeError(w, r, http.StatusUnauthorized, "invalid_session", "The widget session is invalid or expired", nil)
		return
	}
	after := r.URL.Query().Get("after")
	if len(after) > 180 || (after != "" && !safeClientMessageID(after)) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "validation_failed", "The cursor is not a valid message id", nil)
		return
	}

	var transcript []model.Message
	_ = s.store.View(func(state *model.State) error {
		for _, message := range state.Messages {
			if message.SessionID == session.ID {
				transcript = append(transcript, message.Clone())
			}
		}
		return nil
	})
	sortMessagesByTime(transcript)

	// Everything from the cursor's moment onward, NOT everything after its
	// position.
	//
	// The difference is a message that goes missing forever. An operator types a
	// reply while the model is still generating; the reply is stored first, the
	// model's answer is stored second with a later timestamp, and the widget --
	// which appended the model's answer itself -- polls with that as its cursor.
	// Position-based slicing then starts AFTER the model's answer, and the
	// operator's reply, which sorts before it, is never sent. The one message a
	// person actually typed is the one that is lost.
	//
	// Re-sending from the cursor's timestamp costs a few duplicates, and the
	// widget already discards those by id.
	fresh := transcript
	if after != "" {
		for index := range transcript {
			if transcript[index].ID != after {
				continue
			}
			from := transcript[index].CreatedAt.Add(-pollGraceWindow)
			start := index
			for start > 0 && !transcript[start-1].CreatedAt.Before(from) {
				start--
			}
			fresh = transcript[start:]
			break
		}
	}
	if len(fresh) > widgetPollLimit {
		fresh = fresh[len(fresh)-widgetPollLimit:]
	}

	s.writeData(w, http.StatusOK, map[string]any{
		"messages": publicWidgetHistory(fresh, widgetPollLimit),
	})
}

// sortMessagesByTime orders a transcript the way it was written. Ties keep their
// existing order, so two messages stamped in the same millisecond stay in the
// sequence they were appended in rather than swapping between polls.
func sortMessagesByTime(messages []model.Message) {
	sort.SliceStable(messages, func(i, j int) bool {
		return messages[i].CreatedAt.Before(messages[j].CreatedAt)
	})
}
