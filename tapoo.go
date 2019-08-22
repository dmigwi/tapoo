package main

import (
	"errors"
	"log"
	"net/http"
	"text/template"
)

//import "github.com/dmigwi/tapoo/maze"

// Main defines where the program executions starts
func main() {
	//maze.Start()
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("./public"))))
	http.HandleFunc("/", publicServer)

	log.Println("Serving on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		panic(errors.New("http.ListenAndServe: " + err.Error()))
	}
}

func publicServer(w http.ResponseWriter, r *http.Request) {
	t, err := template.ParseFiles("template/index.html")
	if err != nil {
		panic(errors.New("publicServer :" + err.Error()))
	}
	t.Execute(w, "")
}
