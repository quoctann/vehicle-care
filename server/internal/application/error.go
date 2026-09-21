package application

// Error identifies an application failure that the HTTP adapter can map safely.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }
