package conversion

import "encoding/json"

func Marshal(payload map[string]any) ([]byte, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	return json.Marshal(payload)
}

func Unmarshal(data []byte) (map[string]any, error) {
	if len(data) == 0 {
		return nil, nil
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func Value[V any](m map[string]any, key string) V {
	var zero V
	value, ok := m[key]
	if !ok {
		return zero
	}

	typedValue, ok := value.(V)
	if !ok {
		return zero
	}

	return typedValue
}

func ValueOK[V any](m map[string]any, key string) (V, bool) {
	var zero V
	value, exists := m[key]
	if !exists || value == nil {
		return zero, false
	}
	typedValue, ok := value.(V)
	if !ok {
		return zero, false
	}
	return typedValue, true
}

func ToPointer[T any](value T) *T {
	return &value
}

func ToValue[T any](ptr *T) T {
	var zero T
	if ptr == nil {
		return zero
	}
	return *ptr
}
