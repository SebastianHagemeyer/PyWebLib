/* docs.js
 *
 * The searchable Documentation page. All the reference content lives in the
 * DOCS array below (grouped into sections of entries), and the code under it
 * renders the sections and filters them live as you type in the search box.
 *
 * To add an entry: drop a { sig, desc, ex } object into the right section, or
 * add a whole new { name, id, blurb, items: [...] } section. sig is the thing
 * you write, desc explains it, ex is a short example. Search matches all three.
 */
(function () {
  "use strict";

  var DOCS = [
    {
      name: "Printing and input", id: "io",
      blurb: "Show things on the screen and ask the user for answers.",
      items: [
        { sig: 'print(x)', desc: "Show something on the screen.", ex: 'print("Hello!")\nprint("Score:", 10)' },
        { sig: 'print(a, b, c)', desc: "Print several things on one line, separated by spaces.", ex: 'print("x", "is", 5)   # x is 5' },
        { sig: 'print(x, end="")', desc: "Print without moving to a new line, so the next print carries on.", ex: 'print("Load", end="")\nprint("ing...")   # Loading...' },
        { sig: 'print(x, col="red")', desc: "Colour the text (this works in our Playground). Any CSS colour: a name, hex, rgb() or hsl().", ex: 'print("Danger!", col="red")\nprint("Ok", col="#22cc88")' },
        { sig: 'input(prompt)', desc: "Ask the user to type something. It always gives back a string (text), even if they type a number.", ex: 'name = input("Your name? ")\nprint("Hi", name)' },
      ]
    },
    {
      name: "Playground extras", id: "sandbox",
      blurb: "A few handy things that work right here in our Playground.",
      items: [
        { sig: 'clear()', desc: "Wipe the output panel. Print again after it to make animations that redraw each frame.", ex: 'import time\nfor i in range(3):\n    clear()\n    print(i)\n    time.sleep(0.5)' },
        { sig: 'print(x, col="red")', desc: "Colour a line of output. Any CSS colour works: a name, hex, rgb() or hsl().", ex: 'print("Win!", col="#22cc88")' },
        { sig: 'input() and time.sleep()', desc: "These pause your program, so they need Chrome or Edge in the Playground (the same as the game library).", ex: 'name = input("Name? ")\nprint("Hi", name)' },
      ]
    },
    {
      name: "Variables and comments", id: "vars",
      blurb: "Store values to use later, and leave notes for yourself.",
      items: [
        { sig: 'x = 5', desc: "Make a variable: a labelled box that holds a value. The name is on the left, the value on the right.", ex: 'age = 12\nname = "Sam"\nprice = 2.5' },
        { sig: 'x = x + 1', desc: "Change a variable using its own value. Here it grows by one.", ex: 'score = 0\nscore = score + 1   # now 1' },
        { sig: 'a, b = 1, 2', desc: "Set more than one variable at once.", ex: 'x, y = 100, 200' },
        { sig: '# comment', desc: "A note for humans. Python ignores everything after the #.", ex: '# this line does nothing\nprint("hi")   # a note here too' },
      ]
    },
    {
      name: "Numbers and maths", id: "maths",
      blurb: "Do sums, and switch between whole numbers and decimals.",
      items: [
        { sig: '+  -  *  /', desc: "Add, subtract, multiply and divide. Division always gives a decimal.", ex: 'print(3 + 4)   # 7\nprint(10 / 4)  # 2.5' },
        { sig: '//', desc: "Whole-number division: divide and throw away the remainder.", ex: 'print(10 // 3)  # 3' },
        { sig: '%', desc: 'The remainder (modulo). Great for "is this even?" and wrapping around.', ex: 'print(10 % 3)  # 1\nprint(8 % 2)   # 0, so 8 is even' },
        { sig: '**', desc: "To the power of.", ex: 'print(2 ** 3)  # 8' },
        { sig: 'int(x)', desc: "Turn text or a decimal into a whole number. Needed after input() for maths.", ex: 'n = int(input("Age? "))\nprint(int(3.9))   # 3' },
        { sig: 'float(x)', desc: "Turn text into a decimal number.", ex: 'price = float("2.50")' },
        { sig: 'round(x, n)', desc: "Round to n decimal places (or the nearest whole number if you leave n out).", ex: 'print(round(3.14159, 2))  # 3.14' },
        { sig: 'abs(x)', desc: "The size of a number, ignoring the minus sign.", ex: 'print(abs(-7))  # 7' },
      ]
    },
    {
      name: "Strings (text)", id: "strings",
      blurb: "Text is a string. Here is how to build it, search it and change it.",
      items: [
        { sig: '"hello"', desc: "A string is text in quotes. Single or double quotes both work.", ex: "greeting = 'hi'\nname = \"Sam\"" },
        { sig: 'a + b', desc: "Join strings together (this is called concatenation).", ex: 'print("Py" + "thon")  # Python' },
        { sig: '"ab" * 3', desc: "Repeat a string.", ex: 'print("=" * 10)  # ==========' },
        { sig: 'f"{x}"', desc: "An f-string: drop variables straight into text inside the curly braces.", ex: 'age = 12\nprint(f"I am {age}")  # I am 12' },
        { sig: 'len(s)', desc: "How many characters are in the string.", ex: 'print(len("cat"))  # 3' },
        { sig: 's[0]', desc: "Get one character by its position. Counting starts at 0.", ex: 'print("cat"[0])  # c' },
        { sig: 's[1:3]', desc: "A slice: the characters from position 1 up to (not including) 3.", ex: 'print("python"[0:3])  # pyt' },
        { sig: 's.upper() / s.lower()', desc: "Make a copy in all capitals, or all lowercase. Handy for comparing answers fairly.", ex: 'print("Hi".upper())  # HI\nif ans.lower() == "yes": ...' },
        { sig: 's.title()', desc: "Capitalise the first letter of each word.", ex: 'print("sam smith".title())  # Sam Smith' },
        { sig: 's.strip()', desc: "Remove spaces from the start and end.", ex: 'print("  hi  ".strip())  # "hi"' },
        { sig: 's.replace(a, b)', desc: "Swap every a for b.", ex: 'print("cat".replace("c", "b"))  # bat' },
        { sig: 's.split(sep)', desc: "Break a string into a list of pieces. Splits on spaces if you do not say where.", ex: 'print("a,b,c".split(","))  # [a, b, c]' },
        { sig: '"x" in s', desc: "Is this piece somewhere inside the string? Gives True or False.", ex: 'print("at" in "cat")  # True' },
        { sig: 's.startswith(x) / s.endswith(x)', desc: "Does the string start or end with this?", ex: 'print("cat.py".endswith(".py"))  # True' },
        { sig: 's.isdigit() / s.isalpha()', desc: "Is the string all digits, or all letters?", ex: 'print("123".isdigit())  # True' },
        { sig: 'str(x)', desc: "Turn a number (or anything) into a string, so you can join it to text.", ex: 'print("Score: " + str(10))' },
        { sig: 'f"{x:.2f}"', desc: "Show a number with an exact number of decimal places. :.2f means 2 decimals, great for money.", ex: 'price = 3.14159\nprint(f"${price:.2f}")  # $3.14' },
        { sig: 'f"{n:>5}"', desc: "Pad a value to a set width so columns line up. > right-aligns, < left-aligns.", ex: 'print(f"{7:>5}")   # "    7"' },
        { sig: '"\\n"', desc: "A new line inside a string. \\t makes a tab. Use \\\" to put a quote inside a string.", ex: 'print("Line 1\\nLine 2")\n# Line 1\n# Line 2' },
      ]
    },
    {
      name: "Lists", id: "lists",
      blurb: "A list holds many values in order, and you can change it as you go.",
      items: [
        { sig: '[1, 2, 3]', desc: "A list. It can hold numbers, strings, anything, in order.", ex: 'pets = ["cat", "dog", "fish"]' },
        { sig: 'list[0]', desc: "Get an item by position (starting at 0).", ex: 'print(pets[0])  # cat' },
        { sig: 'list[-1]', desc: "Negative counts from the end, so -1 is the last item.", ex: 'print(pets[-1])  # fish' },
        { sig: 'len(list)', desc: "How many items are in the list.", ex: 'print(len(pets))  # 3' },
        { sig: 'list.append(x)', desc: "Add an item onto the end.", ex: 'pets.append("bird")' },
        { sig: 'list.pop()', desc: "Remove and give back the last item (or list.pop(i) for position i).", ex: 'last = pets.pop()' },
        { sig: 'list.remove(x)', desc: "Remove the first matching item.", ex: 'pets.remove("dog")' },
        { sig: 'x in list', desc: "Is this item in the list? True or False.", ex: 'print("cat" in pets)  # True' },
        { sig: 'sorted(list)', desc: "A new list, sorted smallest to largest (or A to Z).", ex: 'print(sorted([3, 1, 2]))  # [1, 2, 3]' },
        { sig: 'sum / min / max', desc: "Add up, or find the smallest or largest, of a list of numbers.", ex: 'print(sum([1, 2, 3]))  # 6\nprint(max([4, 9, 2]))  # 9' },
        { sig: 'for x in list', desc: "Do something with each item in turn.", ex: 'for pet in pets:\n    print(pet)' },
      ]
    },
    {
      name: "Dictionaries", id: "dicts",
      blurb: "A dictionary stores pairs: a key, and the value it points to. Like a real dictionary, you look up a word to get its meaning.",
      items: [
        { sig: '{"name": "Sam"}', desc: "A dictionary of key: value pairs. Keys are usually strings.", ex: 'player = {"name": "Sam", "score": 0}' },
        { sig: 'd[key]', desc: "Look up the value for a key.", ex: 'print(player["name"])  # Sam' },
        { sig: 'd[key] = value', desc: "Add a new pair, or change an existing one.", ex: 'player["score"] = 10' },
        { sig: 'key in d', desc: "Is this key in the dictionary? True or False.", ex: 'print("score" in player)  # True' },
        { sig: 'd.get(key, default)', desc: "Look up a key safely: if it is missing you get the default instead of an error.", ex: 'player.get("lives", 3)  # 3 if not set' },
        { sig: 'for k in d', desc: "Loop over the keys. Use d[k] to reach each value.", ex: 'for k in player:\n    print(k, "=", player[k])' },
        { sig: 'len(d)', desc: "How many pairs are in the dictionary.", ex: 'print(len(player))  # 2' },
      ]
    },
    {
      name: "Tuples", id: "tuples",
      blurb: "A tuple is like a list, but it cannot be changed after you make it. Handy for pairs that belong together, like an (x, y) point.",
      items: [
        { sig: '(1, 2)', desc: "A tuple: values in round brackets, in a fixed order.", ex: 'point = (100, 200)' },
        { sig: 'a, b = pair', desc: "Unpack a tuple straight into variables.", ex: 'x, y = (100, 200)\nprint(x)  # 100' },
        { sig: 'point[0]', desc: "Get an item by position, just like a list.", ex: 'print((100, 200)[1])  # 200' },
      ]
    },
    {
      name: "True / False and if", id: "if",
      blurb: "Make your program decide what to do.",
      items: [
        { sig: 'True / False', desc: "The two boolean values. Comparisons give you one of these.", ex: 'happy = True' },
        { sig: '==  !=', desc: "Equal to, and not equal to. Note the double equals for checking.", ex: 'print(3 == 3)  # True\nprint(3 != 5)  # True' },
        { sig: '<  >  <=  >=', desc: "Less than, greater than, and the or-equal versions.", ex: 'print(5 > 3)   # True\nprint(2 <= 2)  # True' },
        { sig: 'and  or  not', desc: "Combine conditions. and needs both true, or needs one, not flips it.", ex: 'if age > 12 and age < 20:\n    print("teenager")' },
        { sig: 'if / elif / else', desc: "Run a block only when a condition is true. elif and else are optional extras.", ex: 'if score >= 50:\n    print("Pass")\nelse:\n    print("Try again")' },
      ]
    },
    {
      name: "Loops", id: "loops",
      blurb: "Repeat things without copy-pasting.",
      items: [
        { sig: 'for i in range(n)', desc: "Repeat n times. i counts 0, 1, 2, ... up to n-1.", ex: 'for i in range(3):\n    print(i)   # 0 1 2' },
        { sig: 'range(a, b)', desc: "Count from a up to (not including) b.", ex: 'for i in range(1, 4):\n    print(i)   # 1 2 3' },
        { sig: 'range(a, b, step)', desc: "Count in steps. A negative step counts down.", ex: 'for i in range(5, 0, -1):\n    print(i)   # 5 4 3 2 1' },
        { sig: 'while condition', desc: "Keep repeating as long as the condition stays true. Make sure something changes, or it never stops.", ex: 'n = 3\nwhile n > 0:\n    print(n)\n    n = n - 1' },
        { sig: 'break', desc: "Jump out of a loop straight away.", ex: 'while True:\n    if done: break' },
        { sig: 'continue', desc: "Skip the rest of this turn and go back to the top of the loop.", ex: 'for i in range(5):\n    if i == 2: continue\n    print(i)' },
        { sig: 'enumerate(list)', desc: "Loop with a counter and the item at the same time.", ex: 'for i, pet in enumerate(pets):\n    print(i, pet)   # 0 cat, 1 dog...' },
        { sig: 'zip(a, b)', desc: "Loop over two lists together, one pair at a time.", ex: 'for name, age in zip(names, ages):\n    print(name, "is", age)' },
      ]
    },
    {
      name: "Functions", id: "functions",
      blurb: "Give a chunk of code a name so you can reuse it.",
      items: [
        { sig: 'def name(args):', desc: "Define your own function. The indented lines run when you call it.", ex: 'def greet(who):\n    print("Hi", who)\n\ngreet("Sam")' },
        { sig: 'return x', desc: "Send a value back out of a function so the caller can use it.", ex: 'def double(n):\n    return n * 2\n\nprint(double(5))  # 10' },
      ]
    },
    {
      name: "Built-in functions", id: "builtins",
      blurb: "Handy tools that are always available, no import needed.",
      items: [
        { sig: 'len(x)', desc: "How many items or characters are in something.", ex: 'len("cat")  # 3\nlen([1, 2])  # 2' },
        { sig: 'range(n)', desc: "A sequence of numbers, mostly used with for loops.", ex: 'list(range(3))  # [0, 1, 2]' },
        { sig: 'type(x)', desc: "What kind of thing is x? Useful for working out a bug.", ex: 'print(type(5))    # int\nprint(type("a"))  # str' },
        { sig: 'int / float / str', desc: "Convert between whole numbers, decimals and text.", ex: 'int("5")    # 5\nstr(5)      # "5"' },
        { sig: 'min / max / sum', desc: "Smallest, largest, and total.", ex: 'max(3, 9, 2)   # 9' },
        { sig: 'sorted(x)', desc: "A sorted copy of a list or string.", ex: 'sorted([3, 1, 2])  # [1, 2, 3]' },
      ]
    },
    {
      name: "When it goes wrong (errors)", id: "errors",
      blurb: "Red errors are not the end of the world, they tell you what to fix. Here are the ones you will meet most.",
      items: [
        { sig: 'NameError', desc: "You used a name Python does not know: a typo, or a variable you have not made yet.", ex: 'print(scoer)   # typo of score\n# fix: check the spelling' },
        { sig: 'TypeError', desc: "You mixed types that do not go together, often text and numbers.", ex: 'print("age " + 5)   # crash\n# fix: "age " + str(5)' },
        { sig: 'ValueError', desc: "The right type but a value that will not work, like turning letters into a number.", ex: 'int("cat")   # crash\n# fix: only int() actual numbers' },
        { sig: 'IndexError', desc: "You asked for a list or string position that does not exist.", ex: 'pets = ["cat"]\npets[5]   # crash, there is no [5]' },
        { sig: 'KeyError', desc: "You asked a dictionary for a key it does not have. Use d.get() to be safe.", ex: 'player["lives"]   # crash if not set\n# fix: player.get("lives", 3)' },
        { sig: 'IndentationError', desc: "Your spaces are wrong: a line is missing its indent, or they do not line up.", ex: 'if x > 0:\nprint("hi")   # needs 4 spaces in front' },
        { sig: 'SyntaxError', desc: "A typo in the shape of the code: a missing colon, bracket or quote.", ex: 'if x > 0   # missing the :\n    print("hi")' },
      ]
    },
    {
      name: "random library", id: "random",
      blurb: 'Start with "import random". For dice, shuffles and surprises.',
      items: [
        { sig: 'random.randint(a, b)', desc: "A random whole number from a to b, including both ends.", ex: 'import random\nrandom.randint(1, 6)  # a dice roll' },
        { sig: 'random.random()', desc: "A random decimal from 0.0 up to 1.0.", ex: 'random.random()  # e.g. 0.37' },
        { sig: 'random.choice(seq)', desc: "Pick one random item from a list or string.", ex: 'random.choice(["heads", "tails"])' },
        { sig: 'random.shuffle(list)', desc: "Shuffle a list into a random order (changes the list itself).", ex: 'cards = [1, 2, 3]\nrandom.shuffle(cards)' },
        { sig: 'random.randrange(n)', desc: "A random whole number from 0 up to (not including) n.", ex: 'random.randrange(10)  # 0..9' },
      ]
    },
    {
      name: "math library", id: "math",
      blurb: 'Start with "import math". For the trickier sums.',
      items: [
        { sig: 'math.sqrt(x)', desc: "Square root.", ex: 'import math\nmath.sqrt(144)  # 12.0' },
        { sig: 'math.pi', desc: "The number pi (about 3.14159).", ex: 'math.pi * r * r   # circle area' },
        { sig: 'math.floor(x) / math.ceil(x)', desc: "Round down, or round up, to a whole number.", ex: 'math.floor(3.9)  # 3\nmath.ceil(3.1)   # 4' },
        { sig: 'math.pow(a, b)', desc: "a to the power of b (** does this too).", ex: 'math.pow(2, 10)  # 1024.0' },
        { sig: 'math.sin / math.cos', desc: "Sine and cosine, in radians. Great for waves and circles.", ex: 'math.sin(math.pi / 2)  # 1.0' },
        { sig: 'math.factorial(n)', desc: "n! = n * (n-1) * ... * 1.", ex: 'math.factorial(5)  # 120' },
      ]
    },
    {
      name: "string library", id: "string",
      blurb: 'Start with "import string". Ready-made sets of letters, handy for ciphers and puzzles.',
      items: [
        { sig: 'string.ascii_uppercase', desc: 'The capital letters "A" to "Z" as one string.', ex: 'import string\nprint(string.ascii_uppercase)  # ABC...Z' },
        { sig: 'string.ascii_lowercase', desc: 'The lowercase letters "a" to "z".', ex: 'print(string.ascii_lowercase)  # abc...z' },
        { sig: 'string.digits', desc: 'The digits "0" to "9".', ex: 'print(string.digits)  # 0123456789' },
        { sig: 'string.ascii_letters', desc: "All the letters, lowercase then uppercase.", ex: 'print(len(string.ascii_letters))  # 52' },
      ]
    },
    {
      name: "statistics library", id: "statistics",
      blurb: 'Start with "import statistics". Averages and spread for a list of numbers.',
      items: [
        { sig: 'statistics.mean(data)', desc: "The average: add them all up and divide by how many.", ex: 'import statistics\nstatistics.mean([2, 4, 6])  # 4' },
        { sig: 'statistics.median(data)', desc: "The middle value when they are sorted.", ex: 'statistics.median([1, 5, 2])  # 2' },
        { sig: 'statistics.mode(data)', desc: "The value that appears most often.", ex: 'statistics.mode([3, 3, 1])  # 3' },
        { sig: 'statistics.stdev(data)', desc: "The standard deviation: how spread out the numbers are.", ex: 'statistics.stdev([2, 4, 6])  # 2.0' },
      ]
    },
    {
      name: "time library", id: "time",
      blurb: 'Start with "import time". Slow your program down.',
      items: [
        { sig: 'time.sleep(seconds)', desc: "Pause for a moment. Great for animations and countdowns. (Needs Chrome or Edge in the Playground.)", ex: 'import time\nfor i in range(3, 0, -1):\n    print(i)\n    time.sleep(1)' },
      ]
    },
    {
      name: "turtle library", id: "turtle",
      blurb: 'Start with "import turtle" to draw with a little pen. Runs in the Playground.',
      items: [
        { sig: 'turtle.forward(n)', desc: "Move forward n steps, drawing a line.", ex: 'import turtle\nturtle.forward(100)' },
        { sig: 'turtle.backward(n)', desc: "Move backwards n steps, still drawing.", ex: 'turtle.backward(50)' },
        { sig: 'turtle.left(deg) / turtle.right(deg)', desc: "Turn on the spot by a number of degrees.", ex: 'turtle.left(90)   # quarter turn' },
        { sig: 'turtle.goto(x, y)', desc: "Walk straight to a spot. (0, 0) is the centre of the window. turtle.setx and turtle.sety change just one of them.", ex: 'turtle.penup()\nturtle.goto(-100, 50)\nturtle.pendown()' },
        { sig: 'turtle.setheading(deg)', desc: "Face an exact direction: 0 is right, 90 is up, 180 is left, 270 is down. turtle.home() walks back to the centre, facing right.", ex: 'turtle.setheading(90)   # face up' },
        { sig: 'turtle.pencolor(c)', desc: "Change the pen colour.", ex: 'turtle.pencolor("red")' },
        { sig: 'turtle.pensize(n)', desc: "How thick the line is.", ex: 'turtle.pensize(5)' },
        { sig: 'turtle.penup() / turtle.pendown()', desc: "Lift the pen to move without drawing, then put it back down.", ex: 'turtle.penup()\nturtle.forward(50)\nturtle.pendown()' },
        { sig: 'turtle.circle(r)', desc: "Draw a circle of radius r. Add a second number for part of one: circle(40, 180) is a half circle.", ex: 'turtle.circle(40)' },
        { sig: 'turtle.begin_fill() / turtle.end_fill()', desc: "Colour a shape in: set turtle.fillcolor, call begin_fill, draw the shape, then end_fill pours the paint.", ex: 'turtle.fillcolor("gold")\nturtle.begin_fill()\nturtle.circle(40)\nturtle.end_fill()' },
        { sig: 'turtle.dot(size, color)', desc: "Stamp a filled dot where the turtle stands, no pen needed.", ex: 'turtle.dot(20, "purple")' },
        { sig: 'turtle.write(text)', desc: "Write words where the turtle stands. An optional font sets the look: font=(\"Arial\", 20, \"normal\").", ex: 'turtle.write("Hi!", font=("Arial", 20, "normal"))' },
        { sig: 'turtle.bgcolor(c)', desc: "Paint the whole window background.", ex: 'turtle.bgcolor("#0b1020")' },
        { sig: 'turtle.speed(n)', desc: "How fast it draws, from 1 (slow) to 10 (fast).", ex: 'turtle.speed(10)' },
        { sig: 'turtle.hideturtle() / turtle.showturtle()', desc: "Hide the arrow (the drawing stays), or bring it back. Nice for a clean finished picture.", ex: 'turtle.hideturtle()' },
        { sig: 'turtle.xcor() / turtle.ycor() / turtle.heading()', desc: "Where the turtle is and which way it is facing. turtle.position() gives (x, y) together.", ex: 'if turtle.ycor() > 150:\n    turtle.setheading(270)' },
        { sig: 'turtle.clear() / turtle.reset()', desc: "clear() wipes the drawing but leaves the turtle where it is; reset() wipes everything and sends it home.", ex: 'turtle.clear()' },
      ]
    },
    {
      name: "game library", id: "game",
      blurb: 'Start with "import game" to make games: sprites, keys, the mouse and collisions. Full walkthrough and sprite table in the ',
      blurbLink: { href: "game/", text: "game guide" },
      items: [
        { sig: 'game.window(w, h)', desc: "Open the game window. Always first. Add background=\"#0b1020\" for a colour.", ex: 'import game\ngame.window(480, 360)' },
        { sig: 'game.fullscreen()', desc: "Fill the whole screen with the game window, great on phones. Put it right after game.window(). On iPhone it is a full-screen overlay (Safari there has no true fullscreen); on a computer or Android it also asks for real fullscreen. Tap the fullscreen button, the on-screen ✕, or press Esc to leave; game.fullscreen(False) exits from code. A portrait window like 400 x 640 fills a phone best.", ex: 'game.window(400, 640)\ngame.fullscreen()' },
        { sig: 'game.sprite(skin, x, y, size=40, asset=False)', desc: 'A sprite you can move around. skin can be a built-in number (0 chicken, 1 dog, 2 bird, 3 egg, 4 coin, 5 basket, 6 shocked, 7 calm, 8 turtle, 9 car, 10 mouse, 11 rocket, 12 asteroid, 13 laser, 14 snake, 15 pacman, 16 ghost), its name like "chicken", or any emoji. Add asset=True to use a sprite you designed in the Asset studio, by its id number.', ex: 'hero = game.sprite("chicken", 100, 200)\nmine = game.sprite(5, 300, 200, asset=True)\nfoe  = game.sprite("🦖", 300, 200)' },
        { sig: 'game.preload(ids)', desc: 'Load your custom Asset-studio art up front (pass an id number, several, or a list) so it is ready the instant you show it instead of popping in the first time. Handy when you set sprite.asset = id while the game is running. Call it once near the top, before the loop.', ex: 'rots = [7, 8, 9]\ngame.preload(rots)\n# ...later...\nplant.asset = random.choice(rots)   # already loaded, no pop-in' },
        { sig: 'sprite.animate(frames, every=6)', desc: 'Flip a sprite through a list of skins on a timer, like a flip-book. Each frame shows for "every" calls to game.frame() (default 6). Pass None to stop. Pac-Man already chomps this way on its own.', ex: 'star = game.sprite("coin", 200, 120)\nstar.animate(["🌑", "🌓", "🌕", "🌗"])   # spins' },
        { sig: 'game.box(x, y, w, h, color, radius)', desc: "A coloured rectangle, centred on (x, y). radius rounds the corners: 0 is square, and anything past half the short side gives a stadium shape. Settable later with box.radius = 10.", ex: 'btn = game.box(400, 40, 160, 44, "#8a4a12", radius=12)' },
        { sig: 'game.circle(x, y, w, h, color)', desc: "A coloured circle, centred on (x, y). Leave h out for a round one; give it to squash the circle into an oval, like a hole in the ground.", ex: 'hole = game.circle(240, 180, 70, 22, "#3d2a1a")' },
        { sig: 'game.label(text, x, y, size, color, background)', desc: "Draw words (a score or a message), centred on (x, y). color is the text colour; the optional background draws a filled box behind the words so they read on any scene. Labels sit on top of other sprites by default (their .layer starts at 1000).", ex: 'board = game.label("Score: 0", 80, 24, color="#ffffff", background="#000000")' },
        { sig: 'game.pressed(key)', desc: 'True while a key is held. "left", "right", "up", "down", "space", or a letter.', ex: 'if game.pressed("left"):\n    bird.x = bird.x - 5' },
        { sig: 'game.mouse_x() / game.mouse_y()', desc: "Where the mouse pointer is, in game coordinates. game.mouse_in() is True while the pointer is over the game window.", ex: 'pet.x = game.mouse_x()\npet.y = game.mouse_y()' },
        { sig: 'game.clicked()', desc: "True once per fresh click on the game window, then False until the next click. One tap, one action: great for buttons and menus.", ex: 'if plant.at_mouse() and game.clicked():\n    plant.size = plant.size + 10' },
        { sig: 'game.mouse_down()', desc: "True while the mouse button is held, like pressed() but for the mouse.", ex: 'if game.mouse_down():\n    power = power + 1' },
        { sig: 'game.hide_cursor()', desc: "Hide the real mouse pointer over the game window, so a sprite can be the pointer instead (a watering can, a crosshair). game.show_cursor() brings it back.", ex: 'game.hide_cursor()\ncan.x = game.mouse_x()' },
        { sig: 'sprite.at_mouse()', desc: "True while the mouse pointer is inside this sprite's collision box. Pair with game.clicked() to make clickable sprites and menu buttons.", ex: 'if start_btn.at_mouse() and game.clicked():\n    menu_open = False' },
        { sig: 'game.playing()', desc: "The loop condition: true while the game runs.", ex: 'while game.playing():\n    game.frame()' },
        { sig: 'game.frame(fps=30)', desc: "Draw one frame and wait. Put it at the end of the loop. It runs at 30 frames a second by default; try game.frame(60) for extra-smooth motion. Things then move twice as far each second, so halve your step sizes to keep the same speed.", ex: 'game.frame()      # smooth\ngame.frame(60)    # even smoother' },
        { sig: 'game.game_over(message, retry=False)', desc: "Show a banner and stop the game. With retry=True a tap or click restarts the game from the top, so players don't have to press Run again (great on phones). Put \\n in the message for line breaks.", ex: 'game.game_over("Game over!\\nTap to play again", retry=True)' },
        { sig: 'game.submit_score(points)', desc: "Records the player's score on the game's per-game leaderboard once you publish it, shown on the game's shared page (best score per player). In the Playground it quietly does nothing, so it is safe to leave in.", ex: 'game.submit_score(score)\ngame.game_over("Score: " + str(score))' },
        { sig: 'game.sound(n)', desc: "Play a short built-in arcade sound, no files needed: 0 beep, 1 buzz, 2 coin, 3 powerup, 4 jump, 5 laser, 6 hit, 7 explosion, 8 win, 9 lose. The names work too, like game.sound(\"coin\"). Browsers only allow audio after a click, and a game is clicked to play, so it just works.", ex: 'if basket.touches(egg):\n    game.sound(2)   # coin\nif basket.touches(bomb):\n    game.sound(1)   # buzz' },
        { sig: 'game.save(key, value)', desc: "Remember a value between runs, in this browser, for this program: coins, unlocked levels, a garden's state. value can be a number, text, True/False, or lists/dicts of those. Each program keeps its own save (per browser, not synced across devices). Save when something changes, not every frame.", ex: 'game.save("coins", 120)\ngame.save("plants", ["carrot", "rose"])' },
        { sig: 'game.load(key, default=None)', desc: "Read back what game.save() stored under key. Returns default the first time, before anything is saved, so a new player starts fresh.", ex: 'coins  = game.load("coins", 0)\nplants = game.load("plants", [])' },
        { sig: 'game.clear_save(key=None)', desc: "Forget one saved value, or this whole program's save when you leave the key out (wire it to a \"New game\" button).", ex: 'game.clear_save("coins")   # just the coins\ngame.clear_save()          # wipe this game\'s save' },
        { sig: 'game.tone(freq, wave="sine", volume=0.15)', desc: "Start a sustained tone and get a handle to steer it live: engines, sirens, drones. Unlike game.sound() (a one-shot), it keeps playing until you .stop() it (or the game ends). Call handle.pitch(hz) and handle.volume(0..1) each frame to change it; wave is \"sine\", \"square\", \"sawtooth\" or \"triangle\". A low sawtooth whose pitch rises with speed makes a convincing car engine.", ex: 'engine = game.tone(60, "sawtooth", 0.12)   # idle hum\nwhile game.playing():\n    engine.pitch(55 + speed * 12)   # ramps up with acceleration\n    engine.volume(0.08 + speed * 0.004)\n    game.frame()\nengine.stop()' },
        { sig: 'game.debug(True)', desc: "Draw a red outline around every sprite's hit box: the area touches() checks for collisions. Put it after game.window(). The box is axis-aligned (it does not spin or scale), so a rotated sprite keeps a straight box.", ex: 'game.window(480, 360)\ngame.debug(True)' },
        { sig: 'sprite.x / sprite.y', desc: "Where a sprite is. Change these to move it.", ex: 'bird.y = bird.y + 5' },
        { sig: 'sprite.content', desc: "What a sprite shows. Set it to a new skin number, a name, or an emoji to change the picture. A label uses it for its text.", ex: 'player.content = "coin"\nboard.content = "Score: " + str(n)' },
        { sig: 'sprite.angle', desc: "Spin a sprite, in degrees.", ex: 'coin.angle = coin.angle + 6' },
        { sig: 'sprite.scale_x / sprite.scale_y', desc: "Stretch or mirror. -1 flips it to face the other way.", ex: 'chicken.scale_x = -1   # face right' },
        { sig: 'sprite.anchor', desc: "The sprite's handle: which point of it sits on (x, y), as fractions of its art, AND the point it spins around. The default (0.5, 0.5) is the middle; (0.5, 1) is the bottom middle, so the sprite stands with its feet on y and swings from its feet like a hammer from its handle; (0, 0) is the top-left corner. The collision box moves and turns with it, so touches() and at_mouse() stay honest.", ex: 'plant.anchor = (0.5, 1)     # stands on its feet\nplant.y = ground_y\n\nhammer.anchor = (0.5, 1)    # swings from the handle\nhammer.angle = swing\n\ncan.anchor = (0.12, 0.7)    # the spout is the pointer' },
        { sig: 'sprite.layer', desc: "Which things draw on top. Higher sits above lower; same layer keeps creation order. Everything starts at 0, except labels which start at 1000. Give a sprite a bigger number to draw it over the score.", ex: 'player.layer = 2000   # over the label\nboard.layer = 0       # label behind' },
        { sig: 'a.touches(b)', desc: "True if two sprites overlap. The collision box turns with .angle and stretches with scale, so a rotated sprite checks a rotated box. Use game.debug(True) to see the boxes.", ex: 'if basket.touches(egg):\n    game.score(1)' },
        { sig: 'sprite.hitbox', desc: "The collision box size as (width, height). Defaults to roughly fit the art (car wide, egg tall); set your own for a tighter fit, or None for automatic.", ex: 'car.hitbox = (46, 26)\ncar.hitbox = None   # back to auto' },
        { sig: 'sprite.remove()', desc: "Delete a sprite for good (once it is collected or destroyed). Keep many in a list and loop over a copy to remove them safely.", ex: 'for egg in eggs[:]:\n    if car.touches(egg):\n        egg.remove()\n        eggs.remove(egg)' },
      ]
    },
    {
      name: "game3d library", id: "game3d",
      blurb: 'Start with "import game3d" for games in real 3D: shapes in space, a camera you can move, and the same game loop you already know. It is new and deliberately small, so expect shapes and colours rather than models and textures. Coordinates are x right, y up, z towards you, measured in steps rather than pixels, so a box of size 1 is one step wide. Keyboard only for now, so it suits a computer rather than a phone. Try the 3D snippets on the Playground.',
      items: [
        { sig: 'game3d.background(color)', desc: "The colour behind everything: your sky.", ex: 'import game3d\ngame3d.background("#8ec5f0")' },
        { sig: 'game3d.ground(size=60, y=0, color)', desc: "A big flat floor to stand things on, centred on (0, 0). Nothing stops you walking off the edge, so make it big enough or keep your player inside it yourself.", ex: 'game3d.ground(40, color="#3f8f4f")' },
        { sig: 'game3d.box(x, y, z, size=1, color)', desc: "A cube at a point in space. y is how high off the ground it sits, so a size 1 box wants y=0.5 to rest on the floor. Use width, height and depth instead of size to make it a slab or a post.", ex: 'cube = game3d.box(0, 0.5, 0, color="#e2483d")\nwall = game3d.box(0, 1, -5, width=8, height=2, depth=0.4)' },
        { sig: 'game3d.sphere(x, y, z, size=1, color)', desc: "A ball. size is its width, so it rests on the floor at y = size / 2.", ex: 'ball = game3d.sphere(3, 0.7, -2, size=1.4, color="#f6c945")' },
        { sig: 'game3d.cylinder(x, y, z, size=1, color)', desc: "A round post or barrel, standing up. Make it a tall pillar with height, or a thin disc.", ex: 'post = game3d.cylinder(-2, 1, 0, size=0.6, height=2)' },
        { sig: 'game3d.camera(x, y, z, look_at=(x, y, z))', desc: "Where you are watching from, and the point you are looking at. Higher y looks down on the scene; bigger z stands further back. fov=80 gives a wider view.", ex: 'game3d.camera(0, 5, 10, look_at=(0, 0, 0))' },
        { sig: 'game3d.camera(follow=thing, distance, height)', desc: "Chase a thing instead: the camera sits behind and above it and keeps looking at it, so it follows your player around. Change distance and height to sit closer or higher.", ex: 'game3d.camera(follow=player, distance=11, height=7)' },
        { sig: 'game3d.pressed(key)', desc: 'True while a key is held, exactly like the 2D game: "left", "right", "up", "down", "space", or a letter.', ex: 'if game3d.pressed("left"):\n    player.x = player.x - 0.25' },
        { sig: 'game3d.frame(fps=60)', desc: "Draw one frame and wait. Put it at the end of your loop, the same as game.frame().", ex: 'while True:\n    player.spin(ry=2)\n    game3d.frame(60)' },
        { sig: 'thing.x / thing.y / thing.z', desc: "Where a thing is. Change these to move it: x right, y up, z towards the camera (so smaller z is further away).", ex: 'player.z = player.z - 0.25   # walk away from the camera' },
        { sig: 'thing.rx / thing.ry / thing.rz', desc: "How far a thing is turned around each axis, in degrees. ry is the usual one: spinning on the spot.", ex: 'cube.ry = 45' },
        { sig: 'thing.spin(rx=0, ry=0, rz=0)', desc: "Turn by this much more, every frame, without doing the addition yourself.", ex: 'coin.spin(ry=3)   # slowly rotates' },
        { sig: 'thing.move(dx=0, dy=0, dz=0)', desc: "Shift a thing by an amount, instead of setting x, y and z one at a time.", ex: 'player.move(dx=0.2, dz=-0.1)' },
        { sig: 'thing.color', desc: "The colour of a thing. Change it whenever you like.", ex: 'if hurt:\n    player.color = "#ffffff"' },
        { sig: 'thing.visible', desc: "Set it to False to hide a thing without deleting it, and True to bring it back.", ex: 'ghost.visible = False' },
        { sig: 'a.touches(b)', desc: "True when two things overlap, checked as boxes around them. Good enough for collecting coins and bumping into walls.", ex: 'if player.touches(coin):\n    coin.remove()' },
        { sig: 'a.distance_to(b)', desc: "How far apart two things are, in steps. Handy for a proximity check, or for deciding what is closest.", ex: 'if player.distance_to(enemy) < 3:\n    game3d.background("#803030")' },
        { sig: 'thing.remove()', desc: "Delete a thing for good. Keep them in a list and loop over a copy to remove them safely, exactly like 2D sprites.", ex: 'for c in coins[:]:\n    if player.touches(c):\n        c.remove()\n        coins.remove(c)' },
        { sig: 'game3d.tick()', desc: "How many frames have been drawn so far. Useful for timing things without a counter of your own.", ex: 'if game3d.tick() % 60 == 0:\n    print("another second")' },
      ]
    }
  ];

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  var body = document.getElementById("docs-body");
  var jump = document.getElementById("docs-jump");
  var search = document.getElementById("docs-search");
  var count = document.getElementById("docs-count");
  var empty = document.getElementById("docs-empty");
  if (!body) return;

  var sectionEls = [];

  DOCS.forEach(function (sec) {
    // Jump link
    var chip = el("a", "docs-chip");
    chip.href = "#sec-" + sec.id;
    chip.textContent = sec.name;
    jump.appendChild(chip);

    var wrap = el("section", "docs-section");
    wrap.id = "sec-" + sec.id;
    var h2 = el("h2", "docs-section-title");
    h2.textContent = sec.name;
    wrap.appendChild(h2);
    if (sec.blurb) {
      var blurb = el("p", "docs-section-blurb", esc(sec.blurb));
      if (sec.blurbLink) {
        var a = el("a", null, esc(sec.blurbLink.text));
        a.href = sec.blurbLink.href;
        blurb.appendChild(a);
        blurb.appendChild(document.createTextNode("."));
      }
      wrap.appendChild(blurb);
    }

    var grid = el("div", "docs-grid");
    var itemEls = [];
    sec.items.forEach(function (it) {
      var card = el("div", "docs-item");
      card.appendChild(el("code", "docs-sig", esc(it.sig)));
      card.appendChild(el("p", "docs-desc", esc(it.desc)));
      if (it.ex) card.appendChild(el("pre", "docs-ex", esc(it.ex)));
      card._hay = (it.sig + " " + it.desc + " " + (it.ex || "")).toLowerCase();
      grid.appendChild(card);
      itemEls.push(card);
    });
    wrap.appendChild(grid);
    body.appendChild(wrap);
    sectionEls.push({ el: wrap, chip: chip, items: itemEls, hay: sec.name.toLowerCase() });
  });

  function apply(q) {
    q = (q || "").trim().toLowerCase();
    var shown = 0;
    sectionEls.forEach(function (s) {
      var anyInSection = false;
      // If the query matches the section name, show all of its items.
      var sectionMatch = q && s.hay.indexOf(q) !== -1;
      s.items.forEach(function (card) {
        var hit = !q || sectionMatch || card._hay.indexOf(q) !== -1;
        card.hidden = !hit;
        if (hit) { anyInSection = true; shown++; }
      });
      s.el.hidden = !anyInSection;
    });
    if (count) count.textContent = q ? (shown + (shown === 1 ? " match" : " matches")) : "";
    if (empty) empty.hidden = shown !== 0;
    if (jump) jump.hidden = !!q;   // hide the jump chips while searching
  }

  var t = null;
  search.addEventListener("input", function () {
    if (t) clearTimeout(t);
    t = setTimeout(function () { apply(search.value); }, 80);
  });
  // Pressing Escape clears the search.
  search.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { search.value = ""; apply(""); }
  });

  apply("");
})();
