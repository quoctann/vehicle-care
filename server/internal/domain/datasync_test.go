package domain

import (
	"encoding/json"
	"testing"
)

func TestSyncContractKeepsWireValues(t *testing.T) {
	mutation := Mutation{EntityType: EntityFuelLog, Operation: OperationCreate}
	encoded, err := json.Marshal(mutation)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Mutation
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.EntityType != EntityFuelLog || decoded.Operation != OperationCreate {
		t.Fatalf("mutation contract changed: %s", encoded)
	}
	result := MutationResult{Status: StatusRetryableError, ErrorCode: MutationErrorInternal}
	encoded, err = json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != `{"mutation_id":"","status":"retryable_error","error_code":"internal_error"}` {
		t.Fatalf("result wire contract changed: %s", encoded)
	}
}

func TestUnknownWireValueIsLeftForApplicationValidation(t *testing.T) {
	var mutation Mutation
	if err := json.Unmarshal([]byte(`{"entity_type":"future_entity","operation":"future_operation"}`), &mutation); err != nil {
		t.Fatal(err)
	}
	if mutation.EntityType != "future_entity" || mutation.Operation != "future_operation" {
		t.Fatalf("unexpected decoded mutation: %#v", mutation)
	}
}
