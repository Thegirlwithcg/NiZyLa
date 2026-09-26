import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--count', default=3)
print(parser.parse_args())
