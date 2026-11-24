package database

import "testing"

func TestWithParam(t *testing.T) {
	cases := map[string]string{
		"u:p@tcp(db)/aiw":                    "u:p@tcp(db)/aiw?parseTime=true",
		"u:p@tcp(db)/aiw?loc=Local":          "u:p@tcp(db)/aiw?loc=Local&parseTime=true",
		"u:p@tcp(db)/aiw?parseTime=True&x=1": "u:p@tcp(db)/aiw?parseTime=True&x=1",
	}
	for in, want := range cases {
		if got := withParam(in, "parseTime", "true"); got != want {
			t.Errorf("withParam(%q) = %q, want %q", in, got, want)
		}
	}
}
