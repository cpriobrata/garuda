package model

import "time"

// Where a captured lead goes, besides into Garuda.
//
// WHY THIS IS PER ACCOUNT AND NOT PER AGENT. A customer's CRM is their CRM. They
// connect HubSpot once and expect every lead in it, from every agent, without
// setting it again on each one — and the connection itself is already account
// scoped, so binding the destination anywhere else would mean two different
// answers to "where is my HubSpot". An agent that genuinely needs its own
// destination is a real case and a later one; making everybody configure per
// agent to serve it would be the wrong trade today.
//
// The outbound webhook remains the answer for everything not in the small list
// of direct destinations. This is the convenience layer on top of it, not a
// replacement for it.
type LeadRoute struct {
	AccountID string `json:"account_id"`

	// Toolkit is the connected app, and Setting is the single value it needs --
	// a Slack channel, a spreadsheet id. Destinations needing nothing leave it
	// empty.
	Toolkit string `json:"toolkit"`
	Setting string `json:"setting,omitempty"`

	// Enabled is separate from existence on purpose. Switching a destination off
	// must not lose the setting somebody typed, or turning it back on is a
	// second trip to find their spreadsheet id.
	Enabled bool `json:"enabled"`

	// LastDeliveredAt and LastError are what the settings screen shows instead of
	// a green tick that means nothing. A destination that has been failing for a
	// week should say so where somebody will see it.
	LastDeliveredAt *time.Time `json:"last_delivered_at,omitempty"`
	LastError       string     `json:"last_error,omitempty"`
	// FailureCount drives the circuit breaker: a destination that keeps refusing
	// stops being tried on every lead.
	FailureCount int `json:"failure_count,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Clone returns a copy that shares no mutable state with the store. Only the
// timestamp is a pointer, and handing out the live one would let a caller see it
// change under them.
func (r LeadRoute) Clone() LeadRoute {
	cloned := r
	if r.LastDeliveredAt != nil {
		moment := *r.LastDeliveredAt
		cloned.LastDeliveredAt = &moment
	}
	return cloned
}
