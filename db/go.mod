module github.com/dmigwi/tapoo/db

go 1.12

require (
	github.com/dmigwi/tapoo/db/utils v0.0.0-00010101000000-000000000000
	github.com/go-sql-driver/mysql v1.4.1
	github.com/satori/go.uuid v1.2.0
	github.com/smartystreets/goconvey v0.0.0-20190731233626-505e41936337
)

replace github.com/dmigwi/tapoo/db/utils => ./utils
