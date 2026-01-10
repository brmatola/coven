package grimoire

import "embed"

//go:embed grimoires/*.yaml
var embeddedGrimoires embed.FS

func init() {
	SetBuiltinGrimoires(embeddedGrimoires)
}
