package conversion

import (
	"encoding/json"
	"fmt"
)

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

func MapValue[V any](m map[string]any, key string) (V, error) {
	var zero V
	value, ok := m[key]
	if !ok {
		return zero, nil
	}

	typedValue, ok := value.(V)
	if !ok {
		return zero, fmt.Errorf("unable to convert %T to %T", value, zero)
	}

	return typedValue, nil
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
