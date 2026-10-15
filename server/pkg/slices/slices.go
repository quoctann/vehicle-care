package slices

import (
	"cmp"
	"math/rand/v2"
	"slices"
	"strings"
)

// Number is a constraint that matches any numeric type (int, float, etc.) can
// use add, sub, mul, div, mod, etc. operations
type Number interface {
	~int | ~int8 | ~int16 | ~int32 | ~int64 |
		~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
		~float32 | ~float64
}

// Map: [1,2,3] -> fn -> [fn(1), fn(2), fn(3)]
func Map[T, U any](s []T, fn func(T) U) []U {
	out := make([]U, len(s))
	for i, v := range s {
		out[i] = fn(v)
	}
	return out
}

// Map but has Index in callback:
// [100,200,300] -> fn -> [fn(100,0), fn(200,1), fn(300,2)]
func MapIdx[T, U any](s []T, fn func(T, int) U) []U {
	out := make([]U, len(s))
	for i, v := range s {
		out[i] = fn(v, i)
	}
	return out
}

// Filter keep elements that satisfy the predicate
func Filter[T any](s []T, pred func(T) bool) []T {
	out := make([]T, 0, len(s))
	for _, v := range s {
		if pred(v) {
			out = append(out, v)
		}
	}
	return out
}

// Filter keep elements that satisfy the predicate, but has Index in callback
func FilterIdx[T any](s []T, pred func(T, int) bool) []T {
	out := make([]T, 0, len(s))
	for i, v := range s {
		if pred(v, i) {
			out = append(out, v)
		}
	}
	return out
}

// Reduce merge elements of slice "s" into a single value, using a callback
// function and an initial value, this loop is from left to right
func Reduce[T, A any](s []T, fn func(accumulator A, current T) A, init A) A {
	acc := init
	for _, v := range s {
		acc = fn(acc, v)
	}
	return acc
}

// Reduce merge elements of slice "s" into a single value, using a callback
// function and an initial value, but has Index "i" in callback, this loop is
// from left to right
func ReduceIdx[T, A any](s []T, fn func(accumulator A, current T, i int) A, init A) A {
	acc := init
	for i, v := range s {
		acc = fn(acc, v, i)
	}
	return acc
}

func Flat[T any](s [][]T) []T {
	n := 0
	for _, in := range s {
		n += len(in)
	}
	out := make([]T, 0, n)
	for _, in := range s {
		out = append(out, in...)
	}
	return out
}

// Find return the first element that satisfies the predicate, or zero value if
// not found
func Find[T any](s []T, pred func(T) bool) (T, bool) {
	for _, v := range s {
		if pred(v) {
			return v, true
		}
	}
	var zero T

	return zero, false
}

// FindIndex return the index of the first element that satisfies the predicate,
// or -1 if not found
func FindIndex[T any](s []T, pred func(T) bool) int {
	return slices.IndexFunc(s, pred)
}

// Every: all elements satisfy the predicate (empty slice -> true)
func Every[T any](s []T, pred func(T) bool) bool {
	for _, v := range s {
		if !pred(v) {
			return false
		}
	}
	return true
}

func Some[T any](s []T, pred func(T) bool) bool {
	return slices.ContainsFunc(s, pred)
}

// Count elements that satisfy the predicate
func Count[T any](s []T, pred func(T) bool) int {
	n := 0
	for _, v := range s {
		if pred(v) {
			n++
		}
	}
	return n
}

// At return the element at index i, support negative index, return (zero value,
// false) if out of range
func At[T any](s []T, i int) (T, bool) {
	if i < 0 {
		i += len(s)
	}
	if i < 0 || i >= len(s) {
		var zero T
		return zero, false
	}
	return s[i], true
}

// First returns the first element
func First[T any](s []T) (T, bool) { return At(s, 0) }

// Last returns the last element
func Last[T any](s []T) (T, bool) { return At(s, -1) }

// Concat multiple slices into one slice
func Concat[T any](ss ...[]T) []T {
	return slices.Concat(ss...)
}

// Push new elements to the end of the slice, return a new slice
func Push[T any](s []T, items ...T) []T {
	out := make([]T, 0, len(s)+len(items))
	out = append(out, s...)
	return append(out, items...)
}

// Pop removes the last element from the slice, return a new slice and the
// removed element
func Pop[T any](s []T) ([]T, T, bool) {
	if len(s) == 0 {
		var zero T
		return []T{}, zero, false
	}
	return slices.Clone(s[:len(s)-1]), s[len(s)-1], true
}

// Shift removes the first element from the slice, return a new slice and the
// removed element
func Shift[T any](s []T) ([]T, T, bool) {
	if len(s) == 0 {
		var zero T
		return []T{}, zero, false
	}
	return slices.Clone(s[1:]), s[0], true
}

// Reverse returns a new slice with the elements in reverse order
func Reverse[T any](s []T) []T {
	out := slices.Clone(s)
	slices.Reverse(out)
	return out
}

// Sort returns a new slice with the elements sorted in ascending order
func Sort[T cmp.Ordered](s []T) []T {
	out := slices.Clone(s)
	slices.Sort(out)
	return out
}

// SortBy returns a new slice with the elements sorted according to the
// comparison function (does not modify the original slice), compFn determines
// which element is less than the other then
func SortBy[T any](s []T, cmpFn func(a, b T) int) []T {
	out := slices.Clone(s)
	slices.SortStableFunc(out, cmpFn)
	return out
}

// SortByKey sorts the slice in ascending order based on the key extracted from
// each element
func SortByKey[T any, K cmp.Ordered](s []T, key func(T) K) []T {
	return SortBy(s, func(a, b T) int { return cmp.Compare(key(a), key(b)) })
}

// Shuffle returns a new slice with the elements shuffled randomly
func Shuffle[T any](s []T) []T {
	out := slices.Clone(s)
	rand.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	return out
}

// Unique remove duplicate elements, keeping the first occurrence
func Unique[T comparable](s []T) []T {
	return UniqueBy(s, func(v T) T { return v })
}

// UniqueBy remove duplicate elements based on a key function, keeping the first
// occurrence
func UniqueBy[T any, K comparable](s []T, key func(T) K) []T {
	seen := make(map[K]struct{}, len(s))
	out := make([]T, 0, len(s))
	for _, v := range s {
		k := key(v)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, v)
	}
	return out
}

// Partition split slice into two slices, one with elements that satisfy the
// predicate and one with elements that do not satisfy the predicate
func Partition[T any](s []T, pred func(T) bool) (pass, fail []T) {
	pass, fail = []T{}, []T{}
	for _, v := range s {
		if pred(v) {
			pass = append(pass, v)
		} else {
			fail = append(fail, v)
		}
	}
	return pass, fail
}

// Chunk split slice into chunks of size n, last chunk may be smaller
func Chunk[T any](s []T, size int) [][]T {
	if size <= 0 {
		return [][]T{}
	}
	out := make([][]T, 0, (len(s)+size-1)/size)
	for i := 0; i < len(s); i += size {
		out = append(out, slices.Clone(s[i:min(i+size, len(s))]))
	}
	return out
}

// Union return the unique elements that are in any of the slices (keep order of
// first slice, no duplicates)
func Union[T comparable](ss ...[]T) []T {
	return Unique(slices.Concat(ss...))
}

// Intersection return the elements that are in both "a" and "b" (keep order of
// "a", no duplicates)
func Intersection[T comparable](a, b []T) []T {
	set := toSet(b)
	return Unique(Filter(a, func(v T) bool { _, ok := set[v]; return ok }))
}

// Difference return the elements in "a" but not in "b" (keep order of "a", no
// duplicates)
func Difference[T comparable](a, b []T) []T {
	set := toSet(b)
	return Filter(a, func(v T) bool { _, ok := set[v]; return !ok })
}

func toSet[T comparable](s []T) map[T]struct{} {
	set := make(map[T]struct{}, len(s))
	for _, v := range s {
		set[v] = struct{}{}
	}
	return set
}

// Sum all elements in the slice, return zero value if empty
func Sum[T Number](s []T) T {
	var total T
	for _, v := range s {
		total += v
	}
	return total
}

// SumBy all elements in the slice, using a callback function to extract the
// number, return zero value if empty
func SumBy[T any, N Number](s []T, fn func(T) N) N {
	var total N
	for _, v := range s {
		total += fn(v)
	}
	return total
}

// Min return the smallest element (ok=false if slice is empty)
func Min[T cmp.Ordered](s []T) (T, bool) {
	if len(s) == 0 {
		var zero T
		return zero, false
	}
	return slices.Min(s), true
}

// Max return the largest element (ok=false if slice is empty)
func Max[T cmp.Ordered](s []T) (T, bool) {
	if len(s) == 0 {
		var zero T
		return zero, false
	}
	return slices.Max(s), true
}

// Join concatenate string slice with separator, using fn to convert each
// element to string
func Join[T any](s []T, sep string, fn func(T) string) string {
	return strings.Join(Map(s, fn), sep)
}
