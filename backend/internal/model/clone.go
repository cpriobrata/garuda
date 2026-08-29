package model

// Values read inside store.View share their maps and slices with the live state,
// because copying a struct copies only the header. Anything that outlives the
// read lock -- most commonly a value JSON-encoded after View returns -- must be
// deep-copied first. Reading a map while another goroutine writes it is a Go
// fatal error, not a panic: it cannot be recovered and it terminates the process.

func cloneStringMap(source map[string]string) map[string]string {
	if source == nil {
		return nil
	}
	cloned := make(map[string]string, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func cloneAnyMap(source map[string]any) map[string]any {
	if source == nil {
		return nil
	}
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func cloneStrings(source []string) []string {
	if source == nil {
		return nil
	}
	return append([]string(nil), source...)
}

// Clone returns a copy of the onboarding record that shares no mutable state
// with the store.
func (o Onboarding) Clone() Onboarding {
	cloned := o
	cloned.Answers = cloneStringMap(o.Answers)
	cloned.Goals = cloneStrings(o.Goals)
	cloned.KeyOffers = cloneStrings(o.KeyOffers)
	if o.FAQs != nil {
		cloned.FAQs = append([]FAQ(nil), o.FAQs...)
	}
	if o.Messages != nil {
		cloned.Messages = append([]OnboardingMessage(nil), o.Messages...)
	}
	return cloned
}

func cloneBool(source *bool) *bool {
	if source == nil {
		return nil
	}
	value := *source
	return &value
}

// Clone returns a copy of the branding configuration that shares no mutable
// state with the store. CustomColors and Toggles are pointers, so copying the
// struct copies only the addresses: without this the caller would hand out a
// handle into live state that a concurrent write can change underneath it.
func (b BrandingConfig) Clone() BrandingConfig {
	cloned := b
	cloned.AllowedDomains = cloneStrings(b.AllowedDomains)
	if b.CustomColors != nil {
		colors := *b.CustomColors
		cloned.CustomColors = &colors
	}
	if b.Toggles != nil {
		cloned.Toggles = &WidgetToggles{
			Transcription:   cloneBool(b.Toggles.Transcription),
			Chat:            cloneBool(b.Toggles.Chat),
			Autostart:       cloneBool(b.Toggles.Autostart),
			MuteOnMinimize:  cloneBool(b.Toggles.MuteOnMinimize),
			MuteOnTabChange: cloneBool(b.Toggles.MuteOnTabChange),
			ShowLeadForm:    cloneBool(b.Toggles.ShowLeadForm),
			IsGlowing:       cloneBool(b.Toggles.IsGlowing),
			IsTransparent:   cloneBool(b.Toggles.IsTransparent),
			AgentMute:       cloneBool(b.Toggles.AgentMute),
		}
	}
	return cloned
}

// Clone returns a copy of the lead capture configuration that shares no mutable
// state with the store. Every form field carries its own Options slice, so the
// field slice has to be rebuilt element by element rather than appended whole.
func (l LeadCaptureConfig) Clone() LeadCaptureConfig {
	cloned := l
	cloned.Fields = cloneStrings(l.Fields)
	if l.FormFields != nil {
		cloned.FormFields = make([]LeadFormField, len(l.FormFields))
		for index, field := range l.FormFields {
			field.Options = cloneStrings(field.Options)
			cloned.FormFields[index] = field
		}
	}
	return cloned
}

// Clone returns a copy of the agent that shares no mutable state with the store.
func (a Agent) Clone() Agent {
	cloned := a
	cloned.SuggestedReplies = cloneStrings(a.SuggestedReplies)
	cloned.Branding = a.Branding.Clone()
	cloned.LeadCapture = a.LeadCapture.Clone()
	if a.Knowledge != nil {
		cloned.Knowledge = append([]KnowledgeItem(nil), a.Knowledge...)
	}
	return cloned
}

// Clone returns a copy of the message that shares no mutable state with the store.
func (m Message) Clone() Message {
	cloned := m
	cloned.Metadata = cloneAnyMap(m.Metadata)
	return cloned
}

// Clone returns a copy of the lead that shares no mutable state with the store.
func (l Lead) Clone() Lead {
	cloned := l
	cloned.Metadata = cloneStringMap(l.Metadata)
	return cloned
}

// Clone returns a copy of the job that shares no mutable state with the store.
func (j Job) Clone() Job {
	cloned := j
	cloned.Result = cloneAnyMap(j.Result)
	return cloned
}
