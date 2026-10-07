package domain

import "time"

type PartType struct {
	ID             string    `json:"id"`
	Code           string    `json:"code"`
	Name           string    `json:"name"`
	DisplayOrder   int32     `json:"display_order"`
	Active         bool      `json:"active"`
	AccountID      string    `json:"account_id"`
	ServerSeq      int64     `json:"server_seq"`
	ServerSyncedAt time.Time `json:"server_synced_at"`
}
