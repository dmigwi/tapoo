package maze

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

// TestPlayerMovement tests the functionality of playerMovement
func TestPlayerMovement(t *testing.T) {
	data := [][]string{
		{"|", "---", "|", "---", "|", "---", "|"},
		{"|", " A ", " ", "   ", "|", "   ", "|"},
		{"|", "   ", "|", "   ", "|", "---", "|"},
		{"|", "   ", " ", " B ", " ", "   ", "|"},
		{"|", "---", "|", "   ", "|", "---", "|"},
		{"|", "   ", "|", "   ", "|", "   ", "|"},
		{"|", "---", "|", "---", "|", "---", "|"},
	}

	Convey("TestPlayerMovement: Given the grid view and the current player position", t, func() {
		var d = Dimensions{Length: 3, Width: 3}

		Convey("is at the middle the player should be able to move to all directions"+
			"position exists for the direction provided", func() {
			for direction, output := range map[string][]int{
				"LEFT": {3, 1}, "RIGHT": {3, 5},
				"DOWN": {5, 3}, "UP": {1, 3}} {

				d.StartPosition = []int{3, 3}

				d.playerMovement(data, direction)

				So(output[0], ShouldEqual, d.StartPosition[0])
				So(output[1], ShouldEqual, d.StartPosition[1])
			}

			Convey("is at a corner, the player should only be able to move to directions with spaces", func() {
				for direction, output := range map[string][]int{
					"LEFT": {1, 1}, "RIGHT": {1, 3},
					"DOWN": {3, 1}, "UP": {1, 1}} {

					d.StartPosition = []int{1, 1}

					d.playerMovement(data, direction)

					So(output[0], ShouldEqual, d.StartPosition[0])
					So(output[1], ShouldEqual, d.StartPosition[1])
				}
			})
		})
	})
}
