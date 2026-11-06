package user

import (
	"bytes"
	"html/template"
)

var tokenHTMLTemplate = template.Must(template.New("account-mail").Parse(`
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>{{.Title}}</title>
  </head>
  <body>
    <h1>{{.Title}}</h1>
    <p>Use the following link to continue:</p>
    <p><a href="{{.Link}}">{{.Title}}</a></p>
    <p>
      This link expires in {{.TTL}}. If you did not request this email, you can
      ignore it.
    </p>
  </body>
</html>
`))

func renderTokenHTML(title, link, ttl string) (string, error) {
	var output bytes.Buffer
	err := tokenHTMLTemplate.Execute(&output, struct{ Title, Link, TTL string }{title, link, ttl})
	return output.String(), err
}
