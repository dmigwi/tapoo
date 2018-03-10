package maze

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

// TestGenarateMazeArea tests the functionality of generateMazeArea
func TestGenarateMazeArea(t *testing.T) {

	var testFunc = func(level int, expectedOutput float64) {
		val := generateMazeArea(level)

		So(val, ShouldHaveSameTypeAs, expectedOutput)
		So(val, ShouldEqual, expectedOutput)
	}

	Convey("TestGenarateMazeArea: Given the level value", t, func() {
		Convey("that is equal to zero, the value returned should be equal the seed value", func() {
			testFunc(0, 100.0)
		})

		Convey("that is greater than zero and less that the max_size, the value returned should be greater than zero", func() {
			testFunc(23, 330.0)
		})

		Convey("that is greater than the max_size value, the size should equal to the maximum maze size supported", func() {
			testFunc(30000, 3000.0)
		})
	})
}

// TestFactorizeMazeArea tests the functionality of factorizeMazeArea
func TestFactorizeMazeArea(t *testing.T) {
	var testFunc = func(mazeArea float64, expectedSize int) {
		area := factorizeMazeArea(mazeArea, Dimensions{Length: 30, Width: 20})

		So(area, ShouldHaveLength, expectedSize)
	}

	Convey("TestFactorizeMazeArea: Given the mazeArea ", t, func() {
		Convey("that can be factorized, several possible maze dimensions should be returned ", func() {
			testFunc(100, 4)
		})

		Convey("that cannot be factorized, no possibilities that should be returned", func() {
			testFunc(97, 0)
		})
	})
}

// TestGetMazeDimension tests the functionality of getMazeDimension
func TestGetMazeDimension(t *testing.T) {
	var testFunc = func(level int, size Dimensions, errMsg string) {
		mazeSize, err := getMazeDimension(level, size)

		if len(errMsg) == 0 {
			So(err, ShouldBeNil)
			So(mazeSize.Length, ShouldBeGreaterThan, 0)
			So(mazeSize.Width, ShouldBeGreaterThan, 0)
		} else {
			So(err, ShouldImplement, (*error)(nil))
			So(err.Error(), ShouldContainSubstring, errMsg)
			So(mazeSize.Length, ShouldEqual, 0)
			So(mazeSize.Width, ShouldEqual, 0)
		}
	}

	Convey("TestGetMazeDimension: Given the level and the terminal size ", t, func() {
		Convey("where the maze area is greater than the terminal size, the second value returned should implement the error interface", func() {
			testFunc(200, Dimensions{Length: 4, Width: 20}, "terminal size is too small")
		})

		Convey("where the maze area cannot fit the terminal size, the second value returned should implement the error interface", func() {
			testFunc(0, Dimensions{Length: 100, Width: 1}, "terminal size is too small")
		})

		Convey("where the maze area is less than the terminal and can be factored, the first value returned should be the dimensions to use", func() {
			testFunc(1, Dimensions{Length: 20, Width: 10}, "")
		})
	})

}
