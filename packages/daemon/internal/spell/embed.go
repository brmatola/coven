package spell

import "embed"

//go:embed spells/*.md
var embeddedSpells embed.FS

func init() {
	SetBuiltinSpells(embeddedSpells)
}
