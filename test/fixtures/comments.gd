extends Node

# score counter
var score = 0  # start

# add points
func add(p):
    # accumulate
    score += p  # plus
    return score

func start_game():
    # greet
    print("hi")  # hello
    add(2)
