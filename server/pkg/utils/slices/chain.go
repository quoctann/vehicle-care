package slices

import (
	"cmp"
	"slices"
)

// Slices is a wrapper that allows method chaining
//
//	slices.From(nums).
//	  Filter(func(n int) bool { return n%2 == 0 }).
//	  Map(func(n int) int { return n * n }).
//	  ToSlice()
//
// Note: Go does not allow methods to have new type parameters, so the Map
// method only transforms T -> T. To change the type (T -> U), use the
// slices.Map(...) function and then wrap it with slices.From(...) if you want
// to continue chaining.
type Slice[T any] []T

// From wrap a slice into an Slice (no copy)
func From[T any](s []T) Slice[T] { return Slice[T](s) }

// Of create an Slice from values
func Of[T any](items ...T) Slice[T] { return Slice[T](items) }

// ToSlice returns a regular slice
func (s Slice[T]) ToSlice() []T { return []T(s) }

// Len returns the number of elements.
func (s Slice[T]) Len() int { return len(s) }

// Clone returns a copy
func (s Slice[T]) Clone() Slice[T] { return slices.Clone(s) }

func (s Slice[T]) Map(fn func(T) T) Slice[T]              { return Map(s, fn) }
func (s Slice[T]) Filter(pred func(T) bool) Slice[T]      { return Filter(s, pred) }
func (s Slice[T]) Reduce(fn func(acc, cur T) T, init T) T { return Reduce(s, fn, init) }
func (s Slice[T]) Find(pred func(T) bool) (T, bool)       { return Find(s, pred) }
func (s Slice[T]) FindIndex(pred func(T) bool) int        { return FindIndex(s, pred) }
func (s Slice[T]) Some(pred func(T) bool) bool            { return Some(s, pred) }
func (s Slice[T]) Every(pred func(T) bool) bool           { return Every(s, pred) }
func (s Slice[T]) Count(pred func(T) bool) int            { return Count(s, pred) }
func (s Slice[T]) At(i int) (T, bool)                     { return At(s, i) }
func (s Slice[T]) First() (T, bool)                       { return First(s) }
func (s Slice[T]) Last() (T, bool)                        { return Last(s) }
func (s Slice[T]) Concat(others ...[]T) Slice[T]          { return Concat(append([][]T{s}, others...)...) }
func (s Slice[T]) Push(items ...T) Slice[T]               { return Push(s, items...) }
func (s Slice[T]) Reverse() Slice[T]                      { return Reverse(s) }
func (s Slice[T]) Shuffle() Slice[T]                      { return Shuffle(s) }
func (s Slice[T]) SortBy(cmpFn func(a, b T) int) Slice[T] { return SortBy(s, cmpFn) }
func (s Slice[T]) Chunk(size int) [][]T                   { return Chunk(s, size) }

func (s Slice[T]) Partition(pred func(T) bool) (Slice[T], Slice[T]) {
	p, f := Partition(s, pred)
	return p, f
}

// SortedBy returns a new slice sorted in ascending order based on the key
// extracted from each element
func SortedBy[T any, K cmp.Ordered](a Slice[T], key func(T) K) Slice[T] {
	return SortByKey(a, key)
}
