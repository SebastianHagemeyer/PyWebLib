/*
 * PyWebLib page furniture. The Python engine (Pyodide with input(),
 * interruptible time.sleep, a Stop button, clear(), print(col=) and the
 * canvas turtle + game modules) lives in pyrun.js. This file owns the page:
 * starter code, the categorised example snippets and toasts. The turtle and
 * game windows appear automatically when the code imports them.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "pyplayground-code";

  const DEFAULT_CODE =
    '# Try editing and hit Run.\n' +
    '# Press Ctrl+Enter to run, Tab to indent.\n\n' +
    'print("Hello, PyWebLib!")\n\n' +
    '# A loop\n' +
    'for i in range(5):\n' +
    '    print("Number:", i, "squared is", i ** 2)\n\n' +
    '# A list\n' +
    'names = ["Alice", "Bob", "Charlie"]\n' +
    'for name in names:\n' +
    '    print("Hey,", name + "!")\n\n' +
    '# Maths\n' +
    'total = sum(range(1, 11))\n' +
    'print("Sum of 1 to 10 is", total)\n';

  // Click-to-load snippets. Each gets a card at the bottom of the page.
  const EXAMPLES = [
    {
      title: "Say hello",
      desc: "Your very first program: print a few messages.",
      code:
        'print("Hello, world!")\n' +
        'print("My name is ...")\n' +
        'print("I am learning Python.")\n'
    },
    {
      title: "Ask your name",
      desc: "Ask a question, then use the answer.",
      code:
        'name = input("What is your name? ")\n' +
        'print("Hello,", name)\n' +
        'print("Nice to meet you!")\n'
    },
    {
      title: "Add two numbers",
      desc: "Type two numbers and add them together.",
      code:
        'a = int(input("First number: "))\n' +
        'b = int(input("Second number: "))\n' +
        'print("The total is", a + b)\n'
    },
    {
      title: "Double it",
      desc: "Type a number and see it doubled.",
      code:
        'n = int(input("Pick a number: "))\n' +
        'print("Double that is", n * 2)\n'
    },
    {
      title: "Count to ten",
      desc: "A simple loop that counts from 1 to 10.",
      code:
        "for i in range(1, 11):\n" +
        "    print(i)\n"
    },
    {
      title: "Odd or even",
      desc: "Ask for a number and say if it is odd or even.",
      code:
        'n = int(input("Pick a number: "))\n' +
        "if n % 2 == 0:\n" +
        '    print("That is even.")\n' +
        "else:\n" +
        '    print("That is odd.")\n'
    },
    {
      title: "Star triangle",
      cat: "Intermediate",
      desc: "Right-aligned stars climbing up.",
      code:
        "x = 1\n" +
        "while x < 10:\n" +
        "    print('%10s' % ('*' * x))\n" +
        "    x = x + 1\n"
    },
    {
      title: "Diamond",
      cat: "Intermediate",
      desc: "Centered stars going up then back down.",
      code:
        "n = 5\n" +
        "for i in range(n):\n" +
        "    print(' ' * (n - i - 1) + '*' * (2 * i + 1))\n" +
        "for i in range(n - 2, -1, -1):\n" +
        "    print(' ' * (n - i - 1) + '*' * (2 * i + 1))\n"
    },
    {
      title: "Times table",
      desc: "The 7 times table, one row at a time.",
      code:
        "n = 7\n" +
        "for i in range(1, 13):\n" +
        "    print(n, 'x', i, '=', n * i)\n"
    },
    {
      title: "FizzBuzz",
      cat: "Intermediate",
      desc: "Count 1 to 20. Fizz, Buzz, FizzBuzz on the multiples.",
      code:
        "for i in range(1, 21):\n" +
        "    if i % 15 == 0:\n" +
        "        print('FizzBuzz')\n" +
        "    elif i % 3 == 0:\n" +
        "        print('Fizz')\n" +
        "    elif i % 5 == 0:\n" +
        "        print('Buzz')\n" +
        "    else:\n" +
        "        print(i)\n"
    },
    {
      title: "Turtle: first drawing",
      desc: "import turtle opens the drawing window. Draw a square.",
      code:
        "import turtle\n" +
        "\n" +
        "for i in range(4):\n" +
        "    turtle.forward(120)\n" +
        "    turtle.left(90)\n"
    },
    {
      title: "Turtle: rainbow spiral",
      desc: "The loop grows the size and rotates the colour.",
      code:
        "import turtle\n" +
        "\n" +
        'colors = ["red", "orange", "yellow", "green", "blue", "purple"]\n' +
        "turtle.speed(10)\n" +
        "\n" +
        "for i in range(48):\n" +
        "    turtle.pencolor(colors[i % 6])\n" +
        "    turtle.forward(i * 5)\n" +
        "    turtle.left(60)\n"
    },
    {
      title: "Game: move the chicken",
      desc: "import game. Steer the chicken with the arrow keys.",
      code:
        "import game\n" +
        "\n" +
        "game.window(480, 360)\n" +
        "# sprite(0) chicken, 1 dog, 2 bird, 3 egg, 4 coin, 5 basket, or an emoji.\n" +
        'chicken = game.sprite("chicken", 240, 300, size=52)\n' +
        "\n" +
        "# The game loop: read the keys, move, draw one frame, repeat.\n" +
        "while game.playing():\n" +
        '    if game.pressed("left"):  chicken.x = chicken.x - 6\n' +
        '    if game.pressed("right"): chicken.x = chicken.x + 6\n' +
        '    if game.pressed("up"):    chicken.y = chicken.y - 6\n' +
        '    if game.pressed("down"):  chicken.y = chicken.y + 6\n' +
        "    game.frame()\n"
    },
    {
      title: "Game: bouncing ball (vs pygame)",
      desc: "The classic pygame bouncing ball, but web-native and smooth. The real pygame version is commented above: in a browser it crawls at about 1 frame a second.",
      code:
        "# --- The real pygame version (works, but about 1 fps in a browser). ---\n" +
        "# import pygame\n" +
        "#\n" +
        "# pygame.init()\n" +
        "# screen = pygame.display.set_mode((600, 400))\n" +
        '# pygame.display.set_caption("Pygame Sample")\n' +
        "# clock = pygame.time.Clock()\n" +
        "#\n" +
        "# x, y, dx, dy, r = 300, 200, 4, 3, 24\n" +
        "# running = True\n" +
        "# while running:\n" +
        "#     for event in pygame.event.get():\n" +
        "#         if event.type == pygame.QUIT:\n" +
        "#             running = False\n" +
        "#     x += dx\n" +
        "#     y += dy\n" +
        "#     if x - r < 0 or x + r > 600: dx = -dx\n" +
        "#     if y - r < 0 or y + r > 400: dy = -dy\n" +
        "#     screen.fill((20, 24, 40))\n" +
        "#     pygame.draw.circle(screen, (233, 30, 99), (x, y), r)\n" +
        "#     pygame.display.flip()\n" +
        "#     clock.tick(60)\n" +
        "#\n" +
        "# pygame.quit()\n" +
        "\n" +
        "# --- The SAME demo with our web-native game library: smooth, no install. ---\n" +
        "import game\n" +
        "\n" +
        'game.window(600, 400, background="#141828")\n' +
        'ball = game.sprite("🔴", 300, 200, size=48)\n' +
        "dx, dy = 4, 3\n" +
        "\n" +
        "while game.playing():\n" +
        "    ball.x = ball.x + dx\n" +
        "    ball.y = ball.y + dy\n" +
        "    if ball.x < 24 or ball.x > 576: dx = -dx\n" +
        "    if ball.y < 24 or ball.y > 376: dy = -dy\n" +
        "    game.frame()\n"
    },
    {
      title: "Game: catch the eggs",
      desc: "Move the basket to catch falling eggs. Miss 3 and it's over.",
      code:
        "import game\n" +
        "import random\n" +
        "\n" +
        'game.window(480, 360, background="#0b1020")\n' +
        'basket = game.sprite("basket", 240, 330, size=52)\n' +
        'egg = game.sprite("egg", random.randint(30, 450), 0, size=34)\n' +
        "misses = 0\n" +
        "\n" +
        "# The scoreboard is just a label you draw. Update its text to change it.\n" +
        'board = game.label("Score: 0", 60, 24, size=22)\n' +
        "\n" +
        "while game.playing():\n" +
        '    if game.pressed("left"):  basket.x = basket.x - 8\n' +
        '    if game.pressed("right"): basket.x = basket.x + 8\n' +
        "\n" +
        "    egg.y = egg.y + 5          # the egg falls\n" +
        "\n" +
        "    if basket.touches(egg):    # caught it!\n" +
        "        game.score(1)\n" +
        "        game.sound(2)          # coin\n" +
        '        board.content = "Score: " + str(game.score())\n' +
        "        egg.x = random.randint(30, 450)\n" +
        "        egg.y = 0\n" +
        "    elif egg.y > 360:          # it hit the floor\n" +
        "        misses = misses + 1\n" +
        "        game.sound(1)          # buzz\n" +
        "        egg.x = random.randint(30, 450)\n" +
        "        egg.y = 0\n" +
        "        if misses >= 3:\n" +
        '            game.game_over("Game Over! Score: " + str(game.score()))\n' +
        "\n" +
        "    game.frame()\n"
    },
    {
      title: "Game: 2-player shout-off",
      desc: "Two players tap A and L. Fill your shout bar to the top first to win.",
      code:
        "import game\n" +
        "\n" +
        'game.window(480, 360, background="#0b1020")\n' +
        'game.label("SHOUT! Tap your key. First bar to the top wins!", 240, 18, size=15)\n' +
        "\n" +
        "# The mouths flip open on every tap, so it looks like shouting.\n" +
        "# 6 (or \"shocked\") is the open mouth, 7 (\"calm\") is the closed one.\n" +
        'p1_mouth = game.sprite("calm", 150, 62, size=52)\n' +
        'p2_mouth = game.sprite("calm", 330, 62, size=52)\n' +
        "\n" +
        "# Grey tracks show how far there is to go...\n" +
        'game.box(150, 210, 60, 240, "#1b2440")\n' +
        'game.box(330, 210, 60, 240, "#1b2440")\n' +
        "\n" +
        "# ...and these coloured bars grow with each tap.\n" +
        'p1_bar = game.box(150, 330, 56, 0, "#4aa3ff")\n' +
        'p2_bar = game.box(330, 330, 56, 0, "#ff5f8f")\n' +
        "\n" +
        'game.label("Player 1  (A)", 150, 348, size=16, color="#4aa3ff")\n' +
        'game.label("Player 2  (L)", 330, 348, size=16, color="#ff5f8f")\n' +
        "\n" +
        "p1 = 0\n" +
        "p2 = 0\n" +
        "TOP = 240        # a full bar\n" +
        "GAIN = 16        # how much one tap adds\n" +
        "DRAIN = 0.8      # how fast the bar leaks back down\n" +
        "\n" +
        "# Remember last frame's keys, so a HELD key counts as one tap, not loads.\n" +
        "p1_was = False\n" +
        "p2_was = False\n" +
        "\n" +
        "while game.playing():\n" +
        '    p1_now = game.pressed("a")\n' +
        '    p2_now = game.pressed("l")\n' +
        "\n" +
        "    if p1_now and not p1_was:          # a fresh tap\n" +
        "        p1 = p1 + GAIN\n" +
        '        p1_mouth.content = "shocked" if p1_mouth.content == "calm" else "calm"\n' +
        "    if p2_now and not p2_was:\n" +
        "        p2 = p2 + GAIN\n" +
        '        p2_mouth.content = "shocked" if p2_mouth.content == "calm" else "calm"\n' +
        "\n" +
        "    p1_was = p1_now\n" +
        "    p2_was = p2_now\n" +
        "\n" +
        "    # Leak back down a little each frame, so you have to keep tapping.\n" +
        "    p1 = max(0, p1 - DRAIN)\n" +
        "    p2 = max(0, p2 - DRAIN)\n" +
        "\n" +
        "    # A box grows upward: keep its bottom at 330, push its top up.\n" +
        "    p1_bar.h = p1\n" +
        "    p1_bar.y = 330 - p1 / 2\n" +
        "    p2_bar.h = p2\n" +
        "    p2_bar.y = 330 - p2 / 2\n" +
        "\n" +
        "    if p1 >= TOP:\n" +
        '        game.game_over("Player 1 wins!")\n' +
        "    if p2 >= TOP:\n" +
        '        game.game_over("Player 2 wins!")\n' +
        "\n" +
        "    game.frame()\n"
    },
    {
      title: "Game: walk and turn around",
      desc: "Side-scroller basics: the runner faces the way it walks (scale_x flips it).",
      code:
        "import game\n" +
        "\n" +
        'game.window(480, 360, background="#87ceeb")\n' +
        'game.box(240, 340, 480, 40, "#5b8f3a")   # the grassy ground\n' +
        "\n" +
        'runner = game.sprite("chicken", 240, 300, size=60)\n' +
        "\n" +
        "# scale_x = -1 mirrors the sprite left-to-right. The chicken faces\n" +
        "# right to start, so we flip it when walking left.\n" +
        "while game.playing():\n" +
        '    if game.pressed("left"):\n' +
        "        runner.x = runner.x - 5\n" +
        "        runner.scale_x = -1    # mirror it to face left\n" +
        '    if game.pressed("right"):\n' +
        "        runner.x = runner.x + 5\n" +
        "        runner.scale_x = 1     # face right (the chicken's default)\n" +
        "    game.frame()\n"
    },
    {
      title: "Game: flappy bird",
      cat: "Advanced Games",
      desc: "Tap the screen (or SPACE) to flap. Gravity pulls you down, dodge the pipes, one point each.",
      code:
        "import game\n" +
        "import random\n" +
        "\n" +
        'game.window(480, 360, background="#4ec0ca")\n' +
        "\n" +
        "GRAVITY = 0.4      # pulls the bird down every frame\n" +
        "FLAP = -6.5        # a tap of space gives this much lift (up is negative)\n" +
        "GAP = 130          # the gap the bird flies through\n" +
        "SPEED = 2.2        # how fast the pipes slide left\n" +
        "FLOOR = 330        # the top of the ground\n" +
        "\n" +
        'game.box(240, 348, 480, 36, "#ded895")   # the ground\n' +
        "\n" +
        "# Two pipe pairs, spaced out. Each one is a top box and a bottom box,\n" +
        "# and we keep its details together in a dictionary.\n" +
        "pipes = []\n" +
        "for i in range(2):\n" +
        "    x = 520 + i * 240\n" +
        '    pipes.append({"x": x,\n' +
        '                  "gy": random.randint(100, 240),\n' +
        '                  "top": game.box(x, 0, 60, 0, "#5fbf3a"),\n' +
        '                  "bottom": game.box(x, 0, 60, 0, "#5fbf3a"),\n' +
        '                  "scored": False})\n' +
        "\n" +
        'bird = game.sprite("bird", 110, 160, size=40)\n' +
        'board = game.label("0", 240, 46, size=36)\n' +
        "\n" +
        "vel = 0\n" +
        "score = 0\n" +
        "space_was = False\n" +
        "\n" +
        "while game.playing():\n" +
        "    # Flap on a tap/click, or a fresh SPACE press (tap, do not hold it).\n" +
        '    space_now = game.pressed("space")\n' +
        "    if game.clicked() or (space_now and not space_was):\n" +
        "        vel = FLAP\n" +
        "    space_was = space_now\n" +
        "\n" +
        "    # Gravity: speed up downwards, then move, then tilt to match.\n" +
        "    vel = vel + GRAVITY\n" +
        "    bird.y = bird.y + vel\n" +
        "    bird.angle = max(-25, min(70, vel * 5))\n" +
        "\n" +
        "    for p in pipes:\n" +
        '        p["x"] = p["x"] - SPEED\n' +
        '        if p["x"] < -40:                      # off the left: send it back\n' +
        '            p["x"] = p["x"] + 480\n' +
        '            p["gy"] = random.randint(100, 240)\n' +
        '            p["scored"] = False\n' +
        "\n" +
        "        # Put the two green boxes above and below the gap.\n" +
        '        top_h = p["gy"] - GAP // 2\n' +
        '        p["top"].x = p["x"]\n' +
        '        p["top"].h = top_h\n' +
        '        p["top"].y = top_h / 2\n' +
        '        floor_top = p["gy"] + GAP // 2\n' +
        '        p["bottom"].x = p["x"]\n' +
        '        p["bottom"].h = FLOOR - floor_top\n' +
        '        p["bottom"].y = (floor_top + FLOOR) / 2\n' +
        "\n" +
        "        # A point each time a pipe slips past the bird.\n" +
        '        if not p["scored"] and p["x"] < bird.x:\n' +
        '            p["scored"] = True\n' +
        "            score = score + 1\n" +
        "            board.content = str(score)\n" +
        "\n" +
        "        # Crashed into a pipe?\n" +
        '        if bird.touches(p["top"]) or bird.touches(p["bottom"]):\n' +
        '            game.game_over("Crashed! Score: " + str(score))\n' +
        "\n" +
        "    # Hit the ground or shot off the top.\n" +
        "    if bird.y > FLOOR - 12 or bird.y < 0:\n" +
        '        game.game_over("Score: " + str(score))\n' +
        "\n" +
        "    game.frame()\n"
    },
    {
      title: "Game: drive a car",
      desc: "Top-down driving: arrows turn and drive, and it coasts to a stop.",
      code:
        "import game\n" +
        "import math\n" +
        "\n" +
        'game.window(480, 360, background="#3a7d3a")   # grass\n' +
        'car = game.sprite("car", 240, 180, size=64)\n' +
        "\n" +
        "speed = 0\n" +
        "TURN = 4          # degrees per press\n" +
        "POWER = 0.4       # how hard the pedal pushes\n" +
        "GRIP = 0.96       # below 1 means it slows down on its own\n" +
        "\n" +
        "while game.playing():\n" +
        '    if game.pressed("left"):  car.angle = car.angle - TURN\n' +
        '    if game.pressed("right"): car.angle = car.angle + TURN\n' +
        '    if game.pressed("up"):    speed = speed + POWER\n' +
        '    if game.pressed("down"):  speed = speed - POWER\n' +
        "\n" +
        "    speed = speed * GRIP        # friction: coast to a stop\n" +
        "\n" +
        "    # Move in the direction the car is pointing.\n" +
        "    a = car.angle * math.pi / 180\n" +
        "    car.x = car.x + math.cos(a) * speed\n" +
        "    car.y = car.y + math.sin(a) * speed\n" +
        "\n" +
        "    # Drive off one edge, come back on the other.\n" +
        "    if car.x < 0:   car.x = 480\n" +
        "    if car.x > 480: car.x = 0\n" +
        "    if car.y < 0:   car.y = 360\n" +
        "    if car.y > 360: car.y = 0\n" +
        "\n" +
        "    game.frame()\n"
    },
    {
      title: "Game: grow a garden",
      cat: "Advanced Games",
      desc: "Start with 5 seeds: drag one to soil, keep the plot wet so it grows over time, then sell the sunflower for coins and buy more seeds from the shop.",
      code:
`import game

W, H = 600, 420
game.window(W, H, background="#8fce6e")   # a sunny lawn

seeds = 5
coins = 0

title = game.label("Grow a Garden", 100, 22, size=22, color="#ffffff", background="#2f6b2f")
seed_lbl = game.label("Seeds: 5", 285, 22, size=18, color="#ffffff", background="#2f6b2f")
coin_lbl = game.label("Coins: 0", 388, 22, size=18, color="#3a2e0a", background="#ffd75e")

# A little shop: click it to spend 2 coins on one more seed.
shop = game.box(522, 22, 130, 30, "#6b4a1f")
shop_lbl = game.label("Buy seed  2", 522, 22, size=16, color="#ffe9a8")

# Five plots. Make the soil FIRST, so the dirt draws under the plants and the
# cursor (whatever you make first is drawn first, so it sits underneath).
plots = []
for i in range(5):
    px = 110 + i * 95
    soil = game.box(px, 270, 70, 32, "#9c6b3f")
    plots.append({"soil": soil, "x": px, "plant": None, "planted": False, "growth": 0.0, "wet": 0.0})
for plot in plots:                      # then the plants, on top of the soil
    plot["plant"] = game.sprite("", plot["x"], 260, size=28)

# The seed you drag to plant it.
tray_x, tray_y = 46, 100
seed = game.sprite("🌱", tray_x, tray_y, size=34)

hint = game.label("Drag a seed to soil. Click to water. Snip a grown sunflower to sell it. Buy seeds in the shop.",
                  300, H - 14, size=13, color="#ffffff", background="#2f6b2f")

# The tool that rides the mouse, made LAST so it always draws on top.
can = game.sprite("🚿", 300, 180, size=40)
game.hide_cursor()

holding = False

def soil_color(w):
    # Darker soil means wetter; it fades back to dry as the plot dries out.
    t = max(0.0, min(1.0, w / 100.0))
    r = int(0x9c + (0x5c - 0x9c) * t)
    g = int(0x6b + (0x38 - 0x6b) * t)
    b = int(0x3f + (0x1c - 0x3f) * t)
    return "#%02x%02x%02x" % (r, g, b)

def look(plot):
    g = plot["growth"]
    plot["plant"].size = 24 + g * 0.28
    if g >= 100:
        plot["plant"].content = "🌻"   # a sunflower: ready to sell
    elif g >= 45:
        plot["plant"].content = "🌿"   # leafy
    else:
        plot["plant"].content = "🌱"   # a sprout

def sell_pop(plant):
    # A quick bounce right before a sold sunflower vanishes: a big hop then a
    # little one, growing a touch at the top of each hop.
    base_y = plant.y
    base_size = plant.size
    for hop, frames in [(34, 6), (13, 4)]:
        for step in range(frames):
            t = step / float(frames - 1) if frames > 1 else 0.0
            arc = 4 * t * (1 - t)             # 0 -> 1 -> 0, a smooth arc
            plant.y = base_y - arc * hop
            plant.size = base_size + arc * hop * 0.4
            can.x = game.mouse_x()           # keep the cursor with the mouse:
            can.y = game.mouse_y() - 12       # this bounce runs its own frames
            game.frame()
    plant.y = base_y
    plant.size = base_size

while game.playing():
    can.x = game.mouse_x()
    can.y = game.mouse_y() - 12

    # Plots dry out slowly; a plant only grows while its plot is still wet.
    for plot in plots:
        if plot["wet"] > 0:
            plot["wet"] = max(0.0, plot["wet"] - 0.5)
        plot["soil"].color = soil_color(plot["wet"])
        if plot["planted"] and plot["wet"] > 0 and plot["growth"] < 100:
            plot["growth"] = min(100.0, plot["growth"] + 0.4)
            look(plot)

    # Drag a seed from the tray onto a plot (uses one seed).
    if game.mouse_down():
        if not holding and seeds > 0 and seed.at_mouse():
            holding = True
        if holding:
            seed.x = game.mouse_x()
            seed.y = game.mouse_y()
    elif holding:
        for plot in plots:
            if not plot["planted"] and seed.touches(plot["soil"]):
                plot["planted"] = True
                plot["growth"] = 1.0
                plot["wet"] = 100.0             # planting waters it once
                look(plot)
                game.sound(4)                  # a little "plip" as it goes in
                seeds = seeds - 1
                seed_lbl.content = "Seeds: " + str(seeds)
                break
        seed.x, seed.y = tray_x, tray_y
        holding = False

    # A click: buy in the shop, water a plant, or sell a sunflower.
    if game.clicked():
        if shop.at_mouse():
            if coins >= 2:
                coins = coins - 2
                seeds = seeds + 1
                coin_lbl.content = "Coins: " + str(coins)
                seed_lbl.content = "Seeds: " + str(seeds)
                game.sound(3)                  # powerup: bought a seed
            else:
                game.sound(1)                  # buzz: not enough coins
        else:
            for plot in plots:
                # Click anywhere on the pot (the soil or the plant), so a small
                # sprout is easy to hit and a wet plot can still be topped up.
                if plot["planted"] and (plot["plant"].at_mouse() or plot["soil"].at_mouse()):
                    if plot["growth"] >= 100:
                        game.sound(2)                   # coin: cha-ching!
                        sell_pop(plot["plant"])         # a little bounce first
                        coins = coins + 3               # sell the sunflower
                        coin_lbl.content = "Coins: " + str(coins)
                        plot["planted"] = False
                        plot["growth"] = 0.0
                        plot["plant"].content = ""
                    else:
                        plot["wet"] = 100.0             # a splash of water
                        plot["soil"].color = soil_color(100.0)
                        game.sound(0)                   # a soft blip
                    break

    seed.content = "🌱" if seeds > 0 else ""   # no seed to drag when you run out

    # The cursor shows what you are doing: a hand while carrying a seed,
    # scissors over a ripe sunflower, or the watering can the rest of the time.
    if holding:
        can.content = "✊"
    else:
        over_ripe = False
        for plot in plots:
            if plot["planted"] and plot["growth"] >= 100 and (plot["plant"].at_mouse() or plot["soil"].at_mouse()):
                over_ripe = True
                break
        can.content = "✂️" if over_ripe else "🚿"
        if seed.at_mouse(): can.content = "🖐️"
        if shop.at_mouse(): can.content = "👉"

    game.frame()`
    },
    {
      title: "Game: asteroids",
      cat: "Advanced Games",
      desc: "Turn and thrust with real momentum, so you drift, and blast the rocks with your laser. Big rocks split; clear a wave and a bigger one arrives. Shows off the rocket, asteroid and laser sprites.",
      code:
`# ASTEROIDS
#
# Controls:  LEFT / RIGHT turn the rocket
#            UP fires the engine (real momentum: you drift!)
#            SPACE shoots
#
# Big rocks split into two small ones when shot. Clear the wave and a
# bigger wave arrives. 3 lives; after a hit you blink and cannot be
# hurt for a moment. Fly off one edge, appear on the other.

import game
import math
import random

W = 480
H = 360
game.window(W, H, background="#070b1a")

# A sprinkle of stars (cheap little boxes, drawn under everything).
for i in range(18):
    game.box(random.randint(0, W), random.randint(0, H), 2, 2, color="#3c4a7a")

ship = game.sprite("rocket", W // 2, H // 2, size=40)
board = game.label("Score: 0   Lives: 3", 96, 22, size=18,
                   color="#ffffff", background="#000000")

heading = -90                   # which way the nose points (-90 = up)
vx = 0.0                        # space physics: thrust adds speed,
vy = 0.0                        # and almost nothing takes it away
score = 0
lives = 3
safe = 0                        # invincible frames after a hit
cooldown = 0                    # frames until the gun can fire again
bullets = []
rocks = []
wave = 0

def update_board():
    board.content = "Score: " + str(score) + "   Lives: " + str(lives)

def spawn_wave():
    global wave
    wave = wave + 1
    for i in range(2 + wave):
        # Spawn away from the ship, so a new wave is never instant death.
        while True:
            x = random.randint(20, W - 20)
            y = random.randint(20, H - 20)
            if math.dist((x, y), (ship.x, ship.y)) > 120:
                break
        r = game.sprite("asteroid", x, y, size=44)
        r.vx = random.uniform(-1.6, 1.6)
        r.vy = random.uniform(-1.6, 1.6)
        r.big = True
        rocks.append(r)

def split(rock):
    # A big rock breaks into two fast little ones.
    for i in range(2):
        s = game.sprite("asteroid", rock.x, rock.y, size=26)
        s.vx = random.uniform(-2.4, 2.4)
        s.vy = random.uniform(-2.4, 2.4)
        s.big = False
        rocks.append(s)

spawn_wave()

while game.playing():
    # ---- steer and thrust ----
    if game.pressed("left"):  heading = heading - 5
    if game.pressed("right"): heading = heading + 5
    a = heading * math.pi / 180
    if game.pressed("up"):
        vx = vx + math.cos(a) * 0.25
        vy = vy + math.sin(a) * 0.25
    vx = vx * 0.985             # a whisper of drag so it stays flyable
    vy = vy * 0.985
    ship.x = ship.x + vx
    ship.y = ship.y + vy
    # The rocket sprite points right at angle 0, so the heading IS the angle.
    ship.angle = heading

    # Fly off one edge, appear on the other.
    if ship.x < 0: ship.x = W
    if ship.x > W: ship.x = 0
    if ship.y < 0: ship.y = H
    if ship.y > H: ship.y = 0

    # ---- shoot a laser bolt ----
    if cooldown > 0:
        cooldown = cooldown - 1
    if game.pressed("space") and cooldown == 0:
        b = game.sprite("laser", ship.x + math.cos(a) * 22,
                        ship.y + math.sin(a) * 22, size=22)
        b.angle = heading          # the bolt points the way it flies
        b.vx = math.cos(a) * 9 + vx
        b.vy = math.sin(a) * 9 + vy
        bullets.append(b)
        cooldown = 7

    for b in bullets[:]:
        b.x = b.x + b.vx
        b.y = b.y + b.vy
        if b.x < -10 or b.x > W + 10 or b.y < -10 or b.y > H + 10:
            b.remove()
            bullets.remove(b)

    # ---- rocks drift and wrap ----
    for r in rocks:
        r.x = r.x + r.vx
        r.y = r.y + r.vy
        if r.x < 0: r.x = W
        if r.x > W: r.x = 0
        if r.y < 0: r.y = H
        if r.y > H: r.y = 0

    # ---- bullets hit rocks ----
    for b in bullets[:]:
        for r in rocks[:]:
            if b.touches(r):
                if r.big:
                    split(r)
                    score = score + 10
                else:
                    score = score + 25
                r.remove()
                rocks.remove(r)
                b.remove()
                bullets.remove(b)
                update_board()
                break

    # ---- rocks hit the ship ----
    if safe > 0:
        safe = safe - 1
        ship.visible = (safe % 10) < 6   # blink while invincible
        if safe == 0:
            ship.visible = True
    else:
        for r in rocks:
            if ship.touches(r):
                lives = lives - 1
                update_board()
                if lives == 0:
                    game.submit_score(score)   # leaderboard, if you publish it!
                    game.game_over("Game over! Score: " + str(score))
                ship.x = W // 2
                ship.y = H // 2
                vx = 0.0
                vy = 0.0
                safe = 90
                break

    # ---- wave cleared? a bigger one arrives ----
    if len(rocks) == 0:
        spawn_wave()

    game.frame()`
    },
    {
      title: "Game: whack a mouse",
      desc: "Click the mouse with your mouse before it scurries to the next hole. It gets faster!",
      code:
        "import game\n" +
        "import random\n" +
        "\n" +
        'game.window(480, 360, background="#6b4a2f")   # dirt\n' +
        'sign = game.label("Whack the mouse!  Score: 0", 240, 26,\n' +
        '                  size=20, color="#ffffff", background="#3d2a1a")\n' +
        "\n" +
        "# Nine holes in a 3 by 3 grid.\n" +
        "holes = []\n" +
        "for row in range(3):\n" +
        "    for col in range(3):\n" +
        '        holes.append(game.box(120 + col * 120, 130 + row * 95, 70, 22,\n' +
        '                              color="#3d2a1a"))\n' +
        "\n" +
        'mole = game.sprite("mouse", 120, 116, size=48)\n' +
        "score = 0\n" +
        "timer = 0\n" +
        "\n" +
        "while game.playing():\n" +
        "    timer = timer + 1\n" +
        "    # Time to scurry! The higher your score, the faster it moves.\n" +
        "    if timer >= max(10, 30 - score):\n" +
        "        hole = random.choice(holes)\n" +
        "        mole.x = hole.x\n" +
        "        mole.y = hole.y - 14\n" +
        "        timer = 0\n" +
        "\n" +
        "    if game.clicked() and mole.at_mouse():\n" +
        "        score = score + 1\n" +
        '        sign.content = "Whack the mouse!  Score: " + str(score)\n' +
        "        timer = 99        # whacked! it pops up somewhere else\n" +
        "\n" +
        "    game.frame()\n"
    },
    {
      title: "Game: drag and drop",
      desc: "Hold the mouse button to pick up an animal and carry it into the pen.",
      code:
        "import game\n" +
        "\n" +
        'game.window(480, 360, background="#4a7dbf")\n' +
        'sign = game.label("Drag the animals into the pen!", 240, 26,\n' +
        '                  size=20, color="#ffffff", background="#2a4a73")\n' +
        "\n" +
        'pen = game.box(360, 250, 200, 180, color="#8fce6e")\n' +
        "pen.hitbox = (150, 130)   # count them only when properly inside\n" +
        "#game.debug(True)         # uncomment to see the collision boxes\n" +
        "\n" +
        'animals = [game.sprite("chicken", 80, 100, size=44),\n' +
        '           game.sprite("dog", 80, 190, size=44),\n' +
        '           game.sprite("turtle", 80, 280, size=44)]\n' +
        "\n" +
        "held = None      # which animal we are carrying right now\n" +
        "\n" +
        "while game.playing():\n" +
        "    if game.mouse_down():\n" +
        "        if held is None:              # try to pick something up\n" +
        "            for a in animals:\n" +
        "                if a.at_mouse():\n" +
        "                    held = a\n" +
        "        if held is not None:          # carry it with the pointer\n" +
        "            held.x = game.mouse_x()\n" +
        "            held.y = game.mouse_y()\n" +
        "    else:\n" +
        "        held = None                   # let go of the button, let go of it\n" +
        "\n" +
        "    # Count who is in the pen. Everyone home? You win.\n" +
        "    inside = 0\n" +
        "    for a in animals:\n" +
        "        if a.touches(pen):\n" +
        "            inside = inside + 1\n" +
        "    if inside == len(animals):\n" +
        '        game.game_over("All the animals are safe!")\n' +
        "\n" +
        "    game.frame()\n"
    },
    {
      title: "Game: 3D maze",
      cat: "Advanced Games",
      desc: "A real first-person maze, the same trick the original Doom used. Pure Python, 80 lines.",
      code:
        "import game\n" +
        "import math\n" +
        "\n" +
        "# The map: # is a wall, . is floor, E is the glowing exit door.\n" +
        'MAP = ["############",\n' +
        '       "#..#.......#",\n' +
        '       "#..#..##...#",\n' +
        '       "#.....##...#",\n' +
        '       "#..###.....#",\n' +
        '       "#....#..#..#",\n' +
        '       "##.#.#..#..#",\n' +
        '       "#..#.....#E#",\n' +
        '       "############"]\n' +
        "\n" +
        "W = 480\n" +
        "H = 360\n" +
        'game.window(W, H, background="#000000")\n' +
        "\n" +
        "# Sky above, floor below. The 3D view is drawn on top of these.\n" +
        'game.box(W // 2, H // 4, W, H // 2, color="#2a3550")\n' +
        'game.box(W // 2, 3 * H // 4, W, H // 2, color="#3d3228")\n' +
        "\n" +
        "# One thin box per screen column. Every frame we stretch and shade them.\n" +
        "COLS = 60\n" +
        "STRIP = W / COLS\n" +
        "strips = []\n" +
        "for i in range(COLS):\n" +
        "    strips.append(game.box(i * STRIP + STRIP / 2, H // 2, STRIP + 1, 10,\n" +
        '                           color="#000000"))\n' +
        "\n" +
        'game.label("Find the glowing door!  Arrows walk and turn.", 240, 20,\n' +
        '           size=15, color="#ffffff", background="#000000")\n' +
        "\n" +
        "px = 1.5          # where the player stands on the map\n" +
        "py = 1.5\n" +
        "pa = 0.3          # which way they face, in radians\n" +
        "FOV = 1.05        # how wide the view is (about 60 degrees)\n" +
        "\n" +
        "def cell(x, y):\n" +
        "    if y < 0 or y >= len(MAP) or x < 0 or x >= len(MAP[0]):\n" +
        '        return "#"\n' +
        "    return MAP[int(y)][int(x)]\n" +
        "\n" +
        "while game.playing():\n" +
        '    if game.pressed("left"):  pa = pa - 0.07\n' +
        '    if game.pressed("right"): pa = pa + 0.07\n' +
        "    step = 0\n" +
        '    if game.pressed("up"):    step = 0.12\n' +
        '    if game.pressed("down"):  step = -0.12\n' +
        "    if step != 0:\n" +
        "        nx = px + math.cos(pa) * step\n" +
        "        ny = py + math.sin(pa) * step\n" +
        '        if cell(nx, py) != "#": px = nx    # slide along walls\n' +
        '        if cell(px, ny) != "#": py = ny\n' +
        '    if cell(px, py) == "E":\n' +
        '        game.game_over("You escaped the maze!")\n' +
        "\n" +
        "    # THE 3D TRICK: send one ray out per column of the screen. The\n" +
        "    # further it flies before hitting a wall, the shorter we draw\n" +
        "    # that column. That is the whole illusion.\n" +
        "    for i in range(COLS):\n" +
        "        ra = pa + FOV * (i / COLS - 0.5)\n" +
        "        dx = math.cos(ra)\n" +
        "        dy = math.sin(ra)\n" +
        "        d = 0.2\n" +
        '        hit = "#"\n' +
        "        while d < 12:\n" +
        "            hit = cell(px + dx * d, py + dy * d)\n" +
        '            if hit == "#" or hit == "E":\n' +
        "                break\n" +
        "            d = d + 0.08\n" +
        "        d = d * math.cos(ra - pa)      # straighten the fish-eye lens\n" +
        "        s = strips[i]\n" +
        "        s.h = min(H, 300 / d)\n" +
        "        shade = max(40, 230 - int(d * 24))\n" +
        '        if hit == "E":                 # the exit door glows green\n' +
        '            s.color = "#%02x%02x%02x" % (shade // 4, shade, shade // 3)\n' +
        "        else:\n" +
        '            s.color = "#%02x%02x%02x" % (shade, shade // 3, shade // 4)\n' +
        "\n" +
        "    game.frame()\n"
    },
    {
      title: "Roll a dice",
      desc: "Random rolls, 10 in a row.",
      code:
        "import random\n" +
        "\n" +
        "for i in range(10):\n" +
        "    roll = random.randint(1, 6)\n" +
        "    print('Roll', i + 1, ':', roll)\n"
    },
    {
      title: "Heat map dice",
      desc: "Rolls coloured red (cold) to green (hot) by value.",
      code:
        "import random\n" +
        "import time\n" +
        "\n" +
        "for i in range(10):\n" +
        "    roll = random.randint(1, 6)\n" +
        "    hue = (roll - 1) * 24   # 0=red ... 120=green\n" +
        "    color = f\"hsl({hue}, 100%, 50%)\"\n" +
        "    print(f\"Roll {i+1}: {'*' * roll}  ({roll})\", col=color)\n" +
        "    time.sleep(0.2)\n"
    },
    {
      title: "Letter staircase",
      cat: "Intermediate",
      desc: "Build up a word, one letter per line.",
      code:
        "word = 'PYTHON'\n" +
        "for i in range(1, len(word) + 1):\n" +
        "    print(word[:i])\n"
    },
    {
      title: "Countdown",
      desc: "Ask for a number, then count down to GO!",
      code:
        "import time\n" +
        "\n" +
        "n = int(input(\"Count down from: \"))\n" +
        "for i in range(n, 0, -1):\n" +
        "    print(i)\n" +
        "    time.sleep(0.5)\n" +
        "print(\"GO!\")\n"
    },
    {
      title: "Loading bar",
      cat: "Intermediate",
      desc: "Animated progress bar filling step by step.",
      code:
        "import time\n" +
        "\n" +
        "n = int(input(\"How many steps? \"))\n" +
        "for i in range(n + 1):\n" +
        "    print('[' + '=' * i + ' ' * (n - i) + ']')\n" +
        "    time.sleep(0.1)\n" +
        "print(\"Done!\")\n"
    },
    {
      title: "Fibonacci",
      cat: "Intermediate",
      desc: "Each number is the sum of the previous two.",
      code:
        "count = int(input(\"How many Fibonacci numbers? \"))\n" +
        "a, b = 0, 1\n" +
        "for _ in range(count):\n" +
        "    print(a)\n" +
        "    a, b = b, a + b\n"
    },
    {
      title: "Hailstone",
      cat: "Intermediate",
      desc: "Halve if even, 3n+1 if odd. Always reaches 1!",
      code:
        "n = int(input(\"Starting number (try 27): \"))\n" +
        "print(\"Start:\", n)\n" +
        "steps = 0\n" +
        "while n != 1:\n" +
        "    n = n // 2 if n % 2 == 0 else 3 * n + 1\n" +
        "    print(n)\n" +
        "    steps += 1\n" +
        "print(\"Reached 1 in\", steps, \"steps!\")\n"
    },
    {
      title: "Spiral",
      cat: "Intermediate",
      desc: "Watch a grid of digits spiral inward, one cell per frame.",
      code:
        "import time\n" +
        "\n" +
        "n = int(input(\"Grid size (try 7): \"))\n" +
        "grid = [[' '] * n for _ in range(n)]\n" +
        "x, y, dx, dy = 0, 0, 1, 0\n" +
        "\n" +
        "for i in range(n * n):\n" +
        "    grid[y][x] = str((i + 1) % 10)\n" +
        "    nx, ny = x + dx, y + dy\n" +
        "    if not (0 <= nx < n and 0 <= ny < n) or grid[ny][nx] != ' ':\n" +
        "        dx, dy = -dy, dx\n" +
        "        nx, ny = x + dx, y + dy\n" +
        "    x, y = nx, ny\n" +
        "    # clear() wipes the output panel - then we redraw the whole grid.\n" +
        "    clear()\n" +
        "    for row in grid:\n" +
        "        print(' '.join(row))\n" +
        "    time.sleep(0.05)\n"
    },
    {
      title: "Colored spiral",
      desc: "Animated spiral with a rainbow hue rotating as it draws.",
      code:
        "import time\n" +
        "\n" +
        "n = int(input(\"Grid size (try 7): \"))\n" +
        "grid   = [[' '] * n for _ in range(n)]\n" +
        "colors = [[''] * n for _ in range(n)]\n" +
        "x, y, dx, dy = 0, 0, 1, 0\n" +
        "\n" +
        "for i in range(n * n):\n" +
        "    grid[y][x] = str((i + 1) % 10)\n" +
        "    colors[y][x] = f\"hsl({i * 360 // (n * n)}, 90%, 60%)\"\n" +
        "    nx, ny = x + dx, y + dy\n" +
        "    if not (0 <= nx < n and 0 <= ny < n) or grid[ny][nx] != ' ':\n" +
        "        dx, dy = -dy, dx\n" +
        "        nx, ny = x + dx, y + dy\n" +
        "    x, y = nx, ny\n" +
        "    clear()\n" +
        "    for r in range(n):\n" +
        "        for c in range(n):\n" +
        "            ch = grid[r][c]\n" +
        "            if ch != ' ':\n" +
        "                print(f\"{ch} \", col=colors[r][c], end='')\n" +
        "            else:\n" +
        "                print('. ', col='#444', end='')\n" +
        "        print(col='white')\n" +
        "    time.sleep(0.05)\n"
    },
    {
      title: "Sine wave",
      cat: "Intermediate",
      desc: "An ASCII wave drawn with math.sin().",
      code:
        "import math\n" +
        "\n" +
        "lines = int(input(\"How many lines? (try 40) \"))\n" +
        "for x in range(lines):\n" +
        "    y = math.sin(x / 4) * 10\n" +
        "    print(' ' * int(y + 12) + '*')\n"
    },
    {
      title: "Sierpinski triangle",
      cat: "Intermediate",
      desc: "A fractal pattern from one bitwise trick.",
      code:
        "n = int(input(\"Size - try 8, 16 or 32: \"))\n" +
        "for y in range(n):\n" +
        "    row = ''\n" +
        "    for x in range(n):\n" +
        "        row += '* ' if (x & (n - 1 - y)) == 0 else '  '\n" +
        "    print(row)\n"
    },
    {
      title: "Rainbow print",
      desc: "Colour text with print(\"hi\", col=\"#FF00AA\"). Any CSS colour works.",
      code:
        "# col= takes hex codes, colour names, rgb() or hsl()\n" +
        "print(\"Hello in red!\", col=\"red\")\n" +
        "print(\"Hex teal\",       col=\"#1abc9c\")\n" +
        "print(\"RGB orange\",     col=\"rgb(255, 165, 0)\")\n" +
        "print(\"HSL navy\",       col=\"hsl(220, 100%, 30%)\")\n" +
        "print()\n" +
        "\n" +
        "print(\"Now a rainbow:\")\n" +
        "words  = \"RED ORANGE YELLOW GREEN BLUE INDIGO VIOLET\".split()\n" +
        "colors = ['#ff0000', '#ff7f00', '#ffff00', '#00cc00', '#1e90ff', '#4b0082', '#9400d3']\n" +
        "for w, c in zip(words, colors):\n" +
        "    print(w, col=c)\n"
    },
    {
      title: "Christmas tree",
      desc: "Green tree with random coloured ornaments and a trunk.",
      code:
        "import random\n" +
        "\n" +
        "n = int(input(\"Tree height (try 8): \"))\n" +
        "GREEN = '#0aa84a'\n" +
        "BROWN = '#7b4a1a'\n" +
        "ORNAMENTS = ['#ff2b2b', '#ffd400', '#ff5cb0', '#3aaeff', '#ff8800']\n" +
        "\n" +
        "for i in range(n):\n" +
        "    pad = ' ' * (n - i - 1)\n" +
        "    print(pad, col=GREEN, end='')\n" +
        "    for j in range(2 * i + 1):\n" +
        "        if 0 < j < 2 * i and random.random() < 0.25:\n" +
        "            print('o', col=random.choice(ORNAMENTS), end='')\n" +
        "        else:\n" +
        "            print('*', col=GREEN, end='')\n" +
        "    print(col=GREEN)\n" +
        "\n" +
        "# Trunk\n" +
        "print(' ' * (n - 2), col=BROWN, end='')\n" +
        "print('|||', col=BROWN)\n"
    },
    {
      title: "Christmas tree (sparkling)",
      desc: "The tree redraws each frame, so the ornaments keep sparkling.",
      code:
        "import random\n" +
        "import time\n" +
        "\n" +
        "n = 8\n" +
        "GREEN = '#0aa84a'\n" +
        "BROWN = '#7b4a1a'\n" +
        "ORNAMENTS = ['#ff2b2b', '#ffd400', '#ff5cb0', '#3aaeff', '#ff8800']\n" +
        "\n" +
        "for frame in range(90):\n" +
        "    for i in range(n):\n" +
        "        pad = ' ' * (n - i - 1)\n" +
        "        print(pad, col=GREEN, end='')\n" +
        "        for j in range(2 * i + 1):\n" +
        "            if 0 < j < 2 * i and random.random() < 0.25:\n" +
        "                print('o', col=random.choice(ORNAMENTS), end='')\n" +
        "            else:\n" +
        "                print('*', col=GREEN, end='')\n" +
        "        print(col=GREEN)\n" +
        "    # Trunk\n" +
        "    print(' ' * (n - 2), col=BROWN, end='')\n" +
        "    print('|||', col=BROWN)\n" +
        "    time.sleep(0.5)\n" +
        "    clear()\n"
    },
    {
      title: "Caesar cipher",
      cat: "Intermediate",
      desc: "Encode OR decode a secret message by shifting letters.",
      code:
        "choice = input(\"Encode or decode? (e/d): \")\n" +
        "msg = input(\"Your message: \")\n" +
        "shift = int(input(\"Shift by how many letters? \"))\n" +
        "\n" +
        "# Decoding is just encoding in the opposite direction.\n" +
        "if choice.lower().startswith(\"d\"):\n" +
        "    shift = -shift\n" +
        "\n" +
        "out = ''\n" +
        "for ch in msg:\n" +
        "    if ch.isalpha():\n" +
        "        out += chr((ord(ch.upper()) - 65 + shift) % 26 + 65)\n" +
        "    else:\n" +
        "        out += ch\n" +
        "print('Original:', msg)\n" +
        "print('Result:  ', out)\n"
    },
    {
      title: "Game: Flappy (made for phones)",
      cat: "Advanced Games",
      desc: "A portrait, tap-to-flap game that fills the whole screen with game.fullscreen(). Tap (or press Space) to flap through the pipes. Try it on your phone.",
      code:
`import game, random

# A tall, portrait window, then fill the screen. Tap (or Space) to flap.
W, H = 400, 640
game.window(W, H, background="#70c5ce")
game.fullscreen()                       # fills the whole screen, great on phones

GRAVITY = 0.5
FLAP = -8.5
GAP = 180                               # space between the top and bottom pipe
SPEED = 3.2
SPACING = 260                           # distance from one pipe to the next

bird = game.sprite("bird", 110, H // 2, size=46)
vy = 0.0
started = False

ground = game.box(W // 2, H - 20, W, 40, "#ded895")
score_lbl = game.label("0", W // 2, 70, size=44, color="#ffffff", background="#00000055")

def place(p, x):
    gap_y = random.randint(150, H - 220)          # centre of the gap
    top_h = gap_y - GAP // 2
    bot_h = (H - 40) - (gap_y + GAP // 2)         # leave room for the ground
    p["x"] = x
    p["scored"] = False
    p["top"].x = x; p["top"].y = top_h / 2;             p["top"].h = top_h
    p["bot"].x = x; p["bot"].y = (H - 40) - bot_h / 2;  p["bot"].h = bot_h

pipes = []
for i in range(3):
    p = {"top": game.box(0, 0, 64, 10, "#5aa02c"),
         "bot": game.box(0, 0, 64, 10, "#5aa02c")}
    place(p, W + 100 + i * SPACING)
    pipes.append(p)

tip = game.label("Tap to flap", W // 2, H // 2 + 90, size=22,
                 color="#ffffff", background="#00000055")

while game.playing():
    if game.clicked() or game.pressed("space"):
        vy = FLAP
        if not started:
            started = True
            tip.hide()
        game.sound("jump")

    if started:
        vy += GRAVITY
        bird.y += vy
        bird.angle = max(-25, min(75, vy * 5))    # tilt down as it falls
        for p in pipes:
            p["top"].x -= SPEED
            p["bot"].x -= SPEED
            if not p["scored"] and p["top"].x < bird.x:
                p["scored"] = True
                score_lbl.content = str(game.score(1))
                game.sound("coin")
            if p["top"].x < -40:
                place(p, max(q["top"].x for q in pipes) + SPACING)
            if bird.touches(p["top"]) or bird.touches(p["bot"]):
                game.sound("hit")
                game.submit_score(game.score())
                game.game_over("Score " + str(game.score()) + " - tap Run to play again")
        if bird.touches(ground) or bird.y < 0:
            game.sound("hit")
            game.submit_score(game.score())
            game.game_over("Score " + str(game.score()) + " - tap Run to play again")

    game.frame(60)
`
    }
  ];

  const editor   = document.getElementById("sandbox-code");
  const output   = document.getElementById("sandbox-output");
  const runBtn   = document.getElementById("sandbox-run");
  const resetBtn = document.querySelector(".sandbox-reset");
  const clearBtn = document.querySelector(".sandbox-clear");
  const maxBtn   = document.querySelector(".sandbox-max");
  const editorPanel = document.querySelector(".sandbox-editor");

  if (!editor || !output || !runBtn || !window.PyRun) return;

  // The turtle / game windows only appear when the program actually uses
  // them; the output console always stays for print()s.
  function usesTurtle(code) {
    return /(^|\n)\s*(import\s+turtle|from\s+turtle\s+import)/.test(code || "");
  }
  function usesGame(code) {
    return /(^|\n)\s*(import\s+game|from\s+game\s+import)/.test(code || "");
  }
  function updatePanels(code) {
    const src = code == null ? runner.getCode() : code;
    const tp = document.getElementById("turtle-panel");
    if (tp) tp.hidden = !usesTurtle(src);
    const gp = document.getElementById("game-panel");
    if (gp) gp.hidden = !usesGame(src);
  }

  const runner = window.PyRun.create({
    editor: editor,
    output: output,
    runBtn: runBtn,
    storageKey: STORAGE_KEY,
    defaultCode: DEFAULT_CODE,
    onChange: function (code) { updatePanels(code); },
    onRunStart: function () {
      // Give the game canvas focus so the arrow keys reach it immediately.
      if (usesGame(runner.getCode())) {
        const cv = document.getElementById("game-canvas");
        if (cv) cv.focus();
      }
    },
    turtle: {
      canvas: document.getElementById("turtle-canvas"),
      sprite: document.getElementById("turtle-sprite")
    },
    game: {
      canvas: document.getElementById("game-canvas")
    }
  });

  function getCode() { return runner.getCode(); }

  // Let the community pages read the current editor code (publish.js).
  window.PWL = window.PWL || {};
  window.PWL.getCode = getCode;
  // Let the Share flow force-stop a running program before it snapshots it, so a
  // turtle's drawing is captured, a game freezes on its last frame, and the game
  // stops eating the keyboard (otherwise the Share form can't type a space).
  window.PWL.stopRun = function () { return runner.stopAndWait(); };
  // Let the Share flow bounce a user into running their program first (so it can
  // capture a real thumbnail): scroll its stage into view and start it.
  window.PWL.startRun = function () {
    const code = getCode();
    const panel = document.getElementById(usesGame(code) ? "game-panel" : usesTurtle(code) ? "turtle-panel" : "");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!runner.isRunning()) runner.run();
  };
  // Load a program's code into the editor without a reload, and bind the editor
  // to it (so Share offers to update it). Used by the "My programs" picker.
  window.PWL.loadProgram = function (code, bind) {
    loadInto(code, "Loaded from your programs");
    setEditing(bind || null);
  };

  if (resetBtn) resetBtn.addEventListener("click", function () {
    loadInto(DEFAULT_CODE, "Reset to the example");
  });
  if (clearBtn) clearBtn.addEventListener("click", function () { runner.clearOutput(); });

  // Maximise: blow the code editor up to fill the screen for distraction-free
  // reading/writing. The bar (Run/Reset) rides along; Esc or the button exits.
  function setMaximised(on) {
    if (!editorPanel) return;
    editorPanel.classList.toggle("is-max", on);
    document.body.classList.toggle("sandbox-maxed", on);
    if (maxBtn) maxBtn.title = on ? "Minimise the code (Esc)" : "Maximise the code";
    editor.focus();
  }
  if (maxBtn && editorPanel) {
    maxBtn.addEventListener("click", function () {
      setMaximised(!editorPanel.classList.contains("is-max"));
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && editorPanel.classList.contains("is-max")) setMaximised(false);
    });
  }

  // ---- Collapsible editor: keep the code capped to the output column's height
  // (game window + output) so the left and right sides line up, with a faded
  // bottom + an expand pill to open the whole file out. ----
  (function setupCollapse() {
    const shell = document.querySelector(".sandbox-shell");
    const right = document.querySelector(".sandbox-right");
    const bar = editorPanel ? editorPanel.querySelector(".sandbox-bar") : null;
    const expandBtn = document.getElementById("sandbox-expand");
    if (!shell || !editorPanel || !right || !expandBtn) return;
    const isMobile = function () { return window.matchMedia("(max-width: 760px)").matches; };

    function measureCap() {
      // Single column (phones): a plain viewport-based cap. Two columns: match
      // the output side so the code never towers over the game/output boxes.
      if (isMobile()) { editorPanel.style.setProperty("--code-cap", "62vh"); return; }
      const barH = bar ? bar.offsetHeight : 44;
      const cap = Math.max(240, Math.round(right.offsetHeight - barH));
      editorPanel.style.setProperty("--code-cap", cap + "px");
    }
    function refreshOverflow() {
      if (editorPanel.classList.contains("is-expanded")) { editorPanel.classList.add("can-expand"); return; }
      const overflowing = editor.scrollHeight > editor.clientHeight + 4;
      editorPanel.classList.toggle("can-expand", overflowing);
    }
    function onScroll() {
      const atEnd = editor.scrollTop + editor.clientHeight >= editor.scrollHeight - 6;
      editorPanel.classList.toggle("scrolled-end", atEnd);
    }
    function refresh() { measureCap(); refreshOverflow(); onScroll(); }

    expandBtn.addEventListener("click", function () {
      const on = !editorPanel.classList.contains("is-expanded");
      editorPanel.classList.toggle("is-expanded", on);
      shell.classList.toggle("editor-expanded", on);
      expandBtn.setAttribute("aria-expanded", on ? "true" : "false");
      const lbl = expandBtn.querySelector(".sandbox-expand-label");
      if (lbl) lbl.textContent = on ? "Collapse" : "Expand";
      if (!on) { editor.scrollTop = 0; editor.focus(); }
      requestAnimationFrame(refreshOverflow);
    });
    editor.addEventListener("scroll", onScroll);
    editor.addEventListener("input", refresh);
    window.addEventListener("resize", refresh);
    if (window.ResizeObserver) {
      try { new ResizeObserver(refresh).observe(right); } catch (e) {}
    }
    // Recheck after the code first renders and after panels toggle in.
    requestAnimationFrame(refresh);
    setTimeout(refresh, 300);
    window.PWL = window.PWL || {};
    window.PWL.refreshEditorCap = refresh;
  })();

  // ---- Fullscreen the game window: the button in the game bar, and the exit
  // ✕ that shows while fullscreen. game.fullscreen() from Python does the same. ----
  (function setupGameFullscreen() {
    const fsBtn = document.querySelector(".game-fs-btn");
    const fsExit = document.querySelector(".game-fs-exit");
    if (fsBtn) fsBtn.addEventListener("click", function () {
      if (window.PWL && window.PWL.toggleGameFullscreen) window.PWL.toggleGameFullscreen();
    });
    if (fsExit) fsExit.addEventListener("click", function () {
      if (window.PWL && window.PWL.setGameFullscreen) window.PWL.setGameFullscreen(false);
    });
  })();

  // The category order shown in the snippet dropdowns, and which one starts open.
  const EXAMPLE_CATEGORIES = ["Basic", "Intermediate", "Coloured Text", "Turtle", "Basic Games", "Advanced Games"];
  const EXAMPLE_OPEN = "Basic";

  // Work out which category a snippet belongs in. An explicit ex.cat wins;
  // otherwise we sort by its title and whether it colours its output.
  function categoryOf(ex) {
    if (ex.cat) return ex.cat;
    if (/^Game:/.test(ex.title)) return "Basic Games";   // ex.cat can move one to "Advanced Games"
    if (/^Turtle:/.test(ex.title)) return "Turtle";
    if (/\bcol\s*=/.test(ex.code)) return "Coloured Text";
    return "Basic";
  }

  function renderExamples() {
    const wrap = document.getElementById("sandbox-examples");
    if (!wrap) return;
    wrap.innerHTML = "";
    EXAMPLE_CATEGORIES.forEach(function (cat) {
      const items = EXAMPLES.filter(function (ex) { return categoryOf(ex) === cat; });
      if (!items.length) return;

      const group = document.createElement("details");
      group.className = "sandbox-example-group";
      if (cat === EXAMPLE_OPEN) group.open = true;   // open this category by default

      const summary = document.createElement("summary");
      summary.innerHTML = escapeHtml(cat) +
        '<span class="sandbox-example-count">' + items.length + '</span>';
      group.appendChild(summary);

      const grid = document.createElement("div");
      grid.className = "sandbox-examples-grid";
      items.forEach(function (ex) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sandbox-example-card";
        btn.innerHTML =
          '<span class="sandbox-example-title">' + escapeHtml(ex.title) + '</span>' +
          '<span class="sandbox-example-desc">' + escapeHtml(ex.desc) + '</span>';
        btn.addEventListener("click", function () {
          loadInto(ex.code, 'Loaded "' + ex.title + '"');
          editor.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        grid.appendChild(btn);
      });
      group.appendChild(grid);
      wrap.appendChild(group);
    });
  }

  // Generic "swap the editor for this code, but offer Undo via a toast"
  // helper. Used by Reset, the snippet cards and My code so the UX is the
  // same everywhere - no more blocking confirm() dialogs.
  let previousCode = null;
  // Which published program (if any) the editor is bound to. Set when a program
  // is opened from the community or its page; publish.js reads it to offer an
  // update instead of a brand new post.
  function setEditing(bind) {
    try {
      window.PWL = window.PWL || {};
      window.PWL.editing = bind || null;
      document.dispatchEvent(new CustomEvent("pwl:editing"));
    } catch (e) {}
  }
  function loadInto(code, message) {
    const cur = getCode();
    if (cur === code) {
      showToast({ message: message + " (already there)" });
      return;
    }
    previousCode = cur;
    runner.setCode(code);
    editor.focus();
    setEditing(null);   // a fresh load is a new program unless a bind follows
    showToast({
      message: message,
      actionLabel: "Undo",
      action: function () {
        if (previousCode == null) return;
        const swap = previousCode;
        previousCode = null;
        runner.setCode(swap);
      }
    });
  }

  function showToast(opts) {
    let toast = document.getElementById("it-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "it-toast";
      toast.className = "toast";
      document.body.appendChild(toast);
      toast.addEventListener("mouseenter", function () {
        if (toast._timer) { clearTimeout(toast._timer); toast._timer = null; }
      });
      toast.addEventListener("mouseleave", function () {
        toast._timer = setTimeout(hideToast, 3000);
      });
    }
    toast.innerHTML = "";
    const msg = document.createElement("span");
    msg.className = "toast-msg";
    msg.textContent = opts.message;
    toast.appendChild(msg);
    if (opts.action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = opts.actionLabel || "Undo";
      btn.addEventListener("click", function () { opts.action(); hideToast(); });
      toast.appendChild(btn);
    }
    requestAnimationFrame(function () { toast.classList.add("show"); });
    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(hideToast, 6000);
  }
  function hideToast() {
    const toast = document.getElementById("it-toast");
    if (!toast) return;
    toast.classList.remove("show");
    if (toast._timer) { clearTimeout(toast._timer); toast._timer = null; }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  renderExamples();
  updatePanels();

  // A community card can hand its code to the Playground: it stashes the code
  // under this key and navigates here. Pick it up once, then clear it.
  try {
    const pending = localStorage.getItem("pyweblib-load");
    if (pending) {
      localStorage.removeItem("pyweblib-load");
      loadInto(pending, "Loaded from the community");
    }
    // An accompanying bind means "you are editing this published program".
    const bind = localStorage.getItem("pyweblib-bind");
    if (bind) {
      localStorage.removeItem("pyweblib-bind");
      try { setEditing(JSON.parse(bind)); } catch (e) {}
    }
  } catch (e) { /* private mode: nothing to load */ }
})();
