package api

import (
	"time"

	"garuda/backend/internal/model"
)

// Retention: the thing that keeps the data file from growing until the service
// cannot start.
//
// WHY THIS HAS TO EXIST. The whole product state is one JSON file, rewritten in
// full on every write and read back at boot. Sessions, messages and jobs were
// append-only with nothing ever removing them. Measured, an ordinary eight-turn
// conversation costs about 4KB, so a hundred customers having fifty
// conversations a month reach an unbootable file in a few months -- with no
// warning signal at all before it happens, because the running process serves
// happily from memory until something restarts it.
//
// WHAT IS DELIBERATELY KEPT FOREVER. Leads. They are what the customer pays for,
// they are small, and deleting somebody's sales pipeline to save disk would be
// choosing the wrong thing to protect. Only the conversation transcript ages
// out, and a lead keeps its own copy of every field it captured.
//
// WHY THE WINDOW IS NINETY DAYS. It is longer than the thirty-day conversation
// window the plan already documents, so nothing a customer can still act on is
// removed, and it is short enough to bound the file. It is a product decision,
// not an implementation detail, which is why it is one named constant here
// rather than a number buried in a loop.
const (
	conversationRetention = 90 * 24 * time.Hour
	jobRetention          = 7 * 24 * time.Hour

	// retentionInterval is how often the sweep runs. Hourly is far more often
	// than ninety-day retention needs; it is cheap, and it means a deployment
	// that has been down for a week catches up in one pass rather than in a
	// burst of them.
	retentionInterval = time.Hour
)

// StartRetention runs the sweep now and then hourly for the life of the process.
//
// The first sweep is immediate and deliberate: a deployment that has been
// accumulating for months should shed it on the restart that ships this, not an
// hour later.
func (s *Server) StartRetention() {
	go func() {
		s.sweepRetention(time.Now().UTC())
		ticker := time.NewTicker(retentionInterval)
		defer ticker.Stop()
		for range ticker.C {
			s.sweepRetention(time.Now().UTC())
		}
	}()
}

// sweepRetention removes what has aged out. It takes ONE write lock and does one
// pass over each slice, because this runs alongside live traffic and every
// millisecond it holds the lock is a millisecond no visitor's message can be
// stored.
func (s *Server) sweepRetention(now time.Time) (removedSessions, removedMessages, removedJobs int) {
	conversationCutoff := now.Add(-conversationRetention)
	jobCutoff := now.Add(-jobRetention)

	// Look FIRST, write only if there is something to remove. Every store.Update
	// rewrites and fsyncs the whole file, so an hourly sweep that removed nothing
	// was an hourly full-database write bought for no reason -- and on a quiet
	// deployment that is every hour of every day.
	needed := false
	_ = s.store.View(func(state *model.State) error {
		for index := range state.Sessions {
			session := &state.Sessions[index]
			if session.LastSeenAt.Before(conversationCutoff) ||
				(session.StartedAt == nil && session.ExpiresAt.Before(now)) {
				needed = true
				return nil
			}
		}
		for index := range state.Jobs {
			if state.Jobs[index].CreatedAt.Before(jobCutoff) {
				needed = true
				return nil
			}
		}
		return nil
	})
	if !needed {
		return 0, 0, 0
	}

	_ = s.store.Update(func(state *model.State) error {
		// Which sessions go is decided first so the message pass is a single
		// lookup per message rather than a scan per message.
		expired := make(map[string]bool)
		keptSessions := state.Sessions[:0]
		for index := range state.Sessions {
			session := &state.Sessions[index]
			if session.LastSeenAt.Before(conversationCutoff) {
				expired[session.ID] = true
				continue
			}
			keptSessions = append(keptSessions, *session)
		}
		removedSessions = len(state.Sessions) - len(keptSessions)
		state.Sessions = keptSessions

		if removedSessions > 0 {
			keptMessages := state.Messages[:0]
			for index := range state.Messages {
				if expired[state.Messages[index].SessionID] {
					continue
				}
				keptMessages = append(keptMessages, state.Messages[index])
			}
			removedMessages = len(state.Messages) - len(keptMessages)
			state.Messages = keptMessages
		}

		// Sessions that were created and never spoke. An anonymous visitor gets a
		// fresh ephemeral id on every request, so the per-visitor budget below
		// cannot match them and never bounded the one route that is public: a
		// flood of session creations wrote permanent rows forever. These expire
		// after fifteen minutes and, having no StartedAt, carry no conversation
		// anybody could want, so once expired there is nothing to keep.
		keptStarted := state.Sessions[:0]
		for index := range state.Sessions {
			session := &state.Sessions[index]
			if session.StartedAt == nil && session.ExpiresAt.Before(now) {
				expired[session.ID] = true
				continue
			}
			keptStarted = append(keptStarted, *session)
		}
		abandoned := len(state.Sessions) - len(keptStarted)
		removedSessions += abandoned
		state.Sessions = keptStarted
		if abandoned > 0 {
			keptMessages := state.Messages[:0]
			for index := range state.Messages {
				if expired[state.Messages[index].SessionID] {
					continue
				}
				keptMessages = append(keptMessages, state.Messages[index])
			}
			removedMessages += len(state.Messages) - len(keptMessages)
			state.Messages = keptMessages
		}

		keptJobs := state.Jobs[:0]
		for index := range state.Jobs {
			if state.Jobs[index].CreatedAt.Before(jobCutoff) {
				continue
			}
			keptJobs = append(keptJobs, state.Jobs[index])
		}
		removedJobs = len(state.Jobs) - len(keptJobs)
		state.Jobs = keptJobs

		// Nothing here removes a Lead. See the note at the top of this file.
		return nil
	})

	if removedSessions > 0 || removedJobs > 0 {
		s.logger.Info("retention sweep",
			"sessions_removed", removedSessions,
			"messages_removed", removedMessages,
			"jobs_removed", removedJobs,
		)
	}
	return removedSessions, removedMessages, removedJobs
}

// maxSessionsPerVisitor bounds what one visitor can make this service store.
//
// createWidgetSession writes a session row and a welcome message unconditionally,
// and the agent key that reaches it is public -- it sits in the embed snippet on
// the customer's own website. At the route's own rate limit that measured at
// 94MB of permanent state per day from a single IP, which reaches an unbootable
// file in about seventeen hours and takes down every tenant at once, not just
// the customer whose key was used.
//
// Twelve is far above what a real visitor produces: the widget resumes an
// existing session rather than creating one, so a person browsing all day
// normally has exactly one.
const maxSessionsPerVisitor = 12

// enforceVisitorSessionBudget drops this visitor's oldest sessions, and their
// messages, once they are past the budget. It runs inside the same Update that
// creates the new session, so the budget can never be exceeded even briefly.
//
// The oldest go first: a visitor's most recent conversation is the one anyone
// would want to read.
func enforceVisitorSessionBudget(state *model.State, agentID, visitorID string) {
	if visitorID == "" {
		return
	}
	var owned []int
	for index := range state.Sessions {
		if state.Sessions[index].AgentID == agentID && state.Sessions[index].VisitorID == visitorID {
			owned = append(owned, index)
		}
	}
	if len(owned) <= maxSessionsPerVisitor {
		return
	}

	// state.Sessions is append-ordered, so the leading indices are the oldest.
	doomed := make(map[string]bool, len(owned)-maxSessionsPerVisitor)
	for _, index := range owned[:len(owned)-maxSessionsPerVisitor] {
		doomed[state.Sessions[index].ID] = true
	}

	keptSessions := state.Sessions[:0]
	for index := range state.Sessions {
		if doomed[state.Sessions[index].ID] {
			continue
		}
		keptSessions = append(keptSessions, state.Sessions[index])
	}
	state.Sessions = keptSessions

	keptMessages := state.Messages[:0]
	for index := range state.Messages {
		if doomed[state.Messages[index].SessionID] {
			continue
		}
		keptMessages = append(keptMessages, state.Messages[index])
	}
	state.Messages = keptMessages
}
