module github.com/dmigwi/tapoo/db

go 1.12

require (
	github.com/dmigwi/tapoo/db/utils v0.0.0-00010101000000-000000000000
	github.com/go-sql-driver/mysql v1.4.1
	github.com/kr/pretty v0.1.0 // indirect
	github.com/satori/go.uuid v1.2.0
	google.golang.org/appengine v1.6.1 // indirect
	gopkg.in/check.v1 v1.0.0-20180628173108-788fd7840127 // indirect
)

replace github.com/dmigwi/tapoo/db/utils => ./utils
