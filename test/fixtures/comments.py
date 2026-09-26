# module header comment
import math  # need math

# Player data
hp = 100  # starting hp

def heal(amount):
    # add amount
    #
    # second paragraph
    global hp
    hp = hp + amount  # clamp later
    return hp

class Box:
    # a box
    def size(self):
        return 3  # fixed

# call it
print(heal(5))  # show
print(math.pi)
# trailing end comment
