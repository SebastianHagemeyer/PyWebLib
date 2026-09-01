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
      title: "Play together",
      desc: "Move a car and see everyone else in the room move too. Open a second tab to be player two.",
      cat: "Multiplayer",
      code:
        "# Multiplayer: everyone running this sees everyone else move.\n" +
        "# Open this page in a SECOND TAB to be your own second player.\n" +
        "import game, net\n" +
        "\n" +
        "net.join(\"pyweblib-demo\")        # same room name = same game\n" +
        "\n" +
        "game.window(480, 360)\n" +
        "me = game.sprite(\"car\", 240, 180, 44)\n" +
        "info = game.label(\"\", 240, 24, 16)\n" +
        "\n" +
        "while game.playing():\n" +
        "    if game.pressed(\"left\"):  me.x -= 5\n" +
        "    if game.pressed(\"right\"): me.x += 5\n" +
        "    if game.pressed(\"up\"):    me.y -= 5\n" +
        "    if game.pressed(\"down\"):  me.y += 5\n" +
        "    me.x = max(22, min(458, me.x))\n" +
        "    me.y = max(22, min(338, me.y))\n" +
        "\n" +
        "    net.me(me)         # show my car to everybody else\n" +
        "    net.others()       # ...and put their cars on my screen\n" +
        "\n" +
        "    if net.online():\n" +
        "        info.content = \"Players here: \" + str(net.count())\n" +
        "    else:\n" +
        "        info.content = \"Connecting...\"\n" +
        "    game.frame(30)\n"
    },
    {
      title: "Bomb tag",
      desc: "Drive into another player to pass them the bomb. Whoever holds it decides who gets it next.",
      cat: "Multiplayer",
      code:
        "# Bomb tag. Drive into another player to pass them the bomb.\n" +
        "# Open a SECOND TAB to play against yourself, or share the room name.\n" +
        "import game, net, random\n" +
        "\n" +
        "net.join(\"bomb-tag\")\n" +
        "\n" +
        "game.window(480, 360)\n" +
        "game.background(\"#101828\")\n" +
        "CAR = 83             # the two Asset-studio sprites: a plain car...\n" +
        "BOMB_CAR = 84        # ...and the same car carrying the bomb\n" +
        "game.preload(CAR, BOMB_CAR)\n" +
        "me = game.sprite(CAR, random.randint(60, 420), random.randint(60, 300), 44, asset=True)\n" +
        "info = game.label(\"\", 240, 24, 16)\n" +
        "\n" +
        "COOLDOWN = 30        # frames you must hold it for: 1 second at 30 fps\n" +
        "KNOCKBACK = 46       # pixels the two of you are shoved apart on a tag\n" +
        "\n" +
        "def back_off(x, y):\n" +
        "    # Push me away from a point. Without this the two cars are still touching\n" +
        "    # the instant the bomb changes hands, so it would come straight back.\n" +
        "    dx, dy = me.x - x, me.y - y\n" +
        "    gap = (dx * dx + dy * dy) ** 0.5\n" +
        "    if gap < 1:                  # dead centre on top of each other\n" +
        "        dx, dy, gap = 1.0, 0.0, 1.0\n" +
        "    me.x += dx / gap * KNOCKBACK\n" +
        "    me.y += dy / gap * KNOCKBACK\n" +
        "\n" +
        "cooldown = 0\n" +
        "had_bomb = False\n" +
        "\n" +
        "while game.playing():\n" +
        "    if game.pressed(\"left\"):  me.x -= 5\n" +
        "    if game.pressed(\"right\"): me.x += 5\n" +
        "    if game.pressed(\"up\"):    me.y -= 5\n" +
        "    if game.pressed(\"down\"):  me.y += 5\n" +
        "\n" +
        "    players = net.others()\n" +
        "    holder = net.get(\"bomb\")\n" +
        "    here = [p.id for p in players] + [net.id]\n" +
        "\n" +
        "    # Nobody has the bomb, OR whoever had it has left the room? The smallest id\n" +
        "    # still here claims it. Every browser sees the same room and agrees, so no\n" +
        "    # one has to be the referee. Without the \"left the room\" half, a holder who\n" +
        "    # closes their tab leaves the bomb pointing at a player who is gone, and\n" +
        "    # nobody can ever be it again.\n" +
        "    if net.online() and holder not in here:\n" +
        "        if net.id == min(here):\n" +
        "            net.set(\"bomb\", net.id)\n" +
        "            holder = net.id\n" +
        "\n" +
        "    mine = (holder == net.id)\n" +
        "\n" +
        "    # Just been handed it? Jump back off whoever tagged me and start the\n" +
        "    # cooldown, so it cannot bounce between two cars that are touching.\n" +
        "    if mine and not had_bomb:\n" +
        "        cooldown = COOLDOWN\n" +
        "        for p in players:\n" +
        "            if me.touches(p):\n" +
        "                back_off(p.x, p.y)\n" +
        "                break\n" +
        "    had_bomb = mine\n" +
        "    if cooldown > 0:\n" +
        "        cooldown -= 1\n" +
        "\n" +
        "    want = BOMB_CAR if mine else CAR\n" +
        "    if me.asset != want:\n" +
        "        me.asset = want\n" +
        "\n" +
        "    # Only whoever HOLDS the bomb ever writes down who has it next, so two\n" +
        "    # players can never disagree about where it is.\n" +
        "    if mine and cooldown == 0:\n" +
        "        for p in players:\n" +
        "            if me.touches(p):\n" +
        "                net.set(\"bomb\", p.id)\n" +
        "                back_off(p.x, p.y)\n" +
        "                break\n" +
        "\n" +
        "    me.x = max(22, min(458, me.x))\n" +
        "    me.y = max(22, min(338, me.y))\n" +
        "    net.me(me)\n" +
        "\n" +
        "    if not net.online():\n" +
        "        info.content = \"Connecting...\"\n" +
        "    elif mine and cooldown > 0:\n" +
        "        info.content = \"You have the bomb! Hold it for \" + str(cooldown // 30 + 1) + \"...\"\n" +
        "    elif mine:\n" +
        "        info.content = \"You have the bomb! Run into someone.\"\n" +
        "    else:\n" +
        "        info.content = \"Players: \" + str(net.count()) + \" - keep away from the bomb!\"\n" +
        "    game.frame(30)\n"
    },
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
      title: "First drawing",
      cat: "Turtle",
      desc: "import turtle opens the drawing window. Draw a square.",
      code:
        "import turtle\n" +
        "\n" +
        "for i in range(4):\n" +
        "    turtle.forward(120)\n" +
        "    turtle.left(90)\n"
    },
    {
      title: "Rainbow spiral",
      cat: "Turtle",
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
      title: "Fractal tree",
      cat: "Turtle",
      desc: "A tree drawn by a function that calls itself. Twelve lines, and no two runs of the numbers give the same tree. The gentlest introduction to recursion there is.",
      code:
        "# A tree that draws itself.\n" +
        "#\n" +
        "# Look at branch(): near the bottom it calls branch(). A function that calls\n" +
        "# itself is recursion, and it is how you draw something with no fixed number\n" +
        "# of parts. Each branch is just a smaller tree growing off the last one.\n" +
        "import turtle\n" +
        "\n" +
        'COLORS = ["#6b4a2f", "#7d5a37", "#3f8f5a", "#4bb06b", "#5be3c0", "#22d3a5"]\n' +
        "\n" +
        "turtle.speed(0)              # 0 means no drawing delay, so it appears at once\n" +
        "turtle.hideturtle()\n" +
        'turtle.bgcolor("#0b1020")\n' +
        "turtle.penup()\n" +
        "turtle.goto(0, -160)         # start near the bottom of the window\n" +
        "turtle.left(90)              # and point straight up\n" +
        "turtle.pendown()\n" +
        "\n" +
        "\n" +
        "def branch(length, depth):\n" +
        "    if depth == 0:           # out of levels: stop splitting\n" +
        "        return\n" +
        "    turtle.pensize(depth)\n" +
        "    turtle.pencolor(COLORS[-depth])   # trunk gets COLORS[-6], twigs COLORS[-1]\n" +
        "    turtle.forward(length)\n" +
        "\n" +
        "    turtle.left(24)\n" +
        "    branch(length * 0.74, depth - 1)     # the whole left half of the tree\n" +
        "    turtle.right(48)\n" +
        "    branch(length * 0.74, depth - 1)     # then the whole right half\n" +
        "    turtle.left(24)\n" +
        "\n" +
        "    turtle.penup()           # pen UP for the walk back, or the trip home\n" +
        "    turtle.backward(length)  # redraws this branch in the last twig's colour\n" +
        "    turtle.pendown()\n" +
        "\n" +
        "\n" +
        "branch(95, 6)\n" +
        'print("A tree from 12 lines. Change 0.74 or the 24 and run it again.")\n'
    },
    {
      title: "Chaos Game",
      cat: "Tech Demo",
      desc: "A fractal you steer while it draws. Arrows change the shape, S saves a clean PNG of just the fractal. Built on game.plot(), which stamps marks that stay put instead of being redrawn every frame.",
      code:
        "# The chaos game, live. A fractal drawn by pure chance, that you can steer\n" +
        "# while it draws.\n" +
        "#\n" +
        "# Pick a corner at random, hop part of the way toward it, leave a dot, repeat.\n" +
        "# Nothing here draws a triangle. The triangle is what the randomness leaves.\n" +
        "#\n" +
        "# game.plot() is the trick: a dot stamped with plot() STAYS on the screen, so\n" +
        "# the picture builds up. Sprites are the opposite, redrawn from scratch every\n" +
        "# single frame, which is why a quarter of a million of them would be hopeless\n" +
        "# and a quarter of a million dots of ink is free.\n" +
        "import game, random, math\n" +
        "\n" +
        'game.window(560, 400, background="#0b1020")\n' +
        "\n" +
        "CX, CY, R = 280, 210, 160          # where the shape sits, and how big\n" +
        "PER_FRAME = 400                    # dots added per frame\n" +
        "LIMIT = 250000                     # stop here, or it eventually goes solid\n" +
        "\n" +
        'colors = ["#22d3a5", "#4ea8ff", "#ff5c8a", "#ffc857",\n' +
        '          "#b48cff", "#5be3c0", "#ff8f4e", "#7ef0ff"]\n' +
        "\n" +
        "corners = 3\n" +
        "hop = 0.5\n" +
        "\n" +
        'info = game.label("", CX, 22, size=15, color="#dbe4ff", background="#161c33")\n' +
        'help1 = game.label("left/right: corners    up/down: hop    SPACE: pause    R: restart",\n' +
        '                   CX, 366, size=12, color="#8fa0c8", background="#161c33")\n' +
        'help2 = game.label("S: save a clean PNG    C: copy it    H: hide this text",\n' +
        '                   CX, 386, size=12, color="#8fa0c8", background="#161c33")\n' +
        "\n" +
        '# game.pressed() is true for every frame a key is held down. For "one press,\n' +
        '# one step" we have to notice the moment it CHANGES from up to down.\n' +
        "held = {}\n" +
        "\n" +
        "\n" +
        "def tapped(key):\n" +
        "    down = game.pressed(key)\n" +
        "    fresh = down and not held.get(key, False)\n" +
        "    held[key] = down\n" +
        "    return fresh\n" +
        "\n" +
        "\n" +
        "def corner_points():\n" +
        "    out = []\n" +
        "    for i in range(corners):\n" +
        "        a = -math.pi / 2 + i * 2 * math.pi / corners\n" +
        "        out.append((CX + R * math.cos(a), CY + R * math.sin(a)))\n" +
        "    return out\n" +
        "\n" +
        "\n" +
        "points = corner_points()\n" +
        "x, y = float(CX), float(CY)\n" +
        "drawn = 0\n" +
        "paused = False\n" +
        "shown = True\n" +
        "\n" +
        "\n" +
        "def restart():\n" +
        "    # Changing the shape means the old dots no longer belong. wipe() clears the\n" +
        "    # stamped layer and leaves the sprites (the text) alone.\n" +
        "    global points, x, y, drawn\n" +
        "    points = corner_points()\n" +
        "    x, y = float(CX), float(CY)\n" +
        "    drawn = 0\n" +
        "    game.wipe()\n" +
        "\n" +
        "\n" +
        "while game.playing():\n" +
        '    if tapped("left") and corners > 3:\n' +
        "        corners -= 1\n" +
        "        restart()\n" +
        '    if tapped("right") and corners < 8:\n' +
        "        corners += 1\n" +
        "        restart()\n" +
        '    if game.pressed("up"):\n' +
        "        hop = min(1.15, hop + 0.005)\n" +
        "        restart()\n" +
        '    if game.pressed("down"):\n' +
        "        hop = max(0.05, hop - 0.005)\n" +
        "        restart()\n" +
        '    if tapped("space"):\n' +
        "        paused = not paused\n" +
        '    if tapped("r"):\n' +
        "        restart()\n" +
        '    if tapped("h"):\n' +
        "        shown = not shown\n" +
        "        for lab in (help1, help2, info):\n" +
        "            lab.show() if shown else lab.hide()\n" +
        '    if tapped("s"):\n' +
        '        # "ink" saves JUST the stamped layer, with none of the text on top, so\n' +
        "        # the fractal comes out clean without having to hide anything first.\n" +
        '        game.save_image("ink")\n' +
        '        print("Saved the fractal to your downloads.")\n' +
        '    if tapped("c"):\n' +
        '        game.copy_image("ink")\n' +
        '        print("Copied the fractal to your clipboard.")\n' +
        "\n" +
        "    if not paused and drawn < LIMIT:\n" +
        "        for _ in range(PER_FRAME):\n" +
        "            c = random.randrange(corners)\n" +
        "            px, py = points[c]\n" +
        "            x += (px - x) * hop\n" +
        "            y += (py - y) * hop\n" +
        "            if not (-4000 < x < 4000 and -4000 < y < 4000):\n" +
        "                x, y = float(CX), float(CY)   # a hop near 1 can fling it away\n" +
        "            game.plot(x, y, colors[c % len(colors)], 1.6)\n" +
        "        drawn += PER_FRAME\n" +
        "\n" +
        '    info.content = ("corners " + str(corners) + "     hop " + str(round(hop, 3)) +\n' +
        '                    "     dots " + str(drawn) + (" (paused)" if paused else ""))\n' +
        "    game.frame(60)\n"
    },
    {
      title: "Move the chicken",
      cat: "Basic Games",
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
        '    if game.pressed("left"):  chicken.x = chicken.x - 3\n' +
        '    if game.pressed("right"): chicken.x = chicken.x + 3\n' +
        '    if game.pressed("up"):    chicken.y = chicken.y - 3\n' +
        '    if game.pressed("down"):  chicken.y = chicken.y + 3\n' +
        "    game.frame(60)\n"
    },
    {
      title: "Grow a garden",
      cat: "Advanced Games",
      sub: "saved",
      desc: "import game + save games. Plant, wait, harvest — and your garden is remembered between runs. Runs at 60fps.",
      code:
        "import game, random\n" +
        "\n" +
        'game.window(480, 360, background="#8fd0ff")\n' +
        "\n" +
        "# Save games: the garden remembers itself between runs.\n" +
        "COST, REWARD = 2, 5\n" +
        'STAGES = ["🟫", "🌱", "🌿", "🌻"]   # empty, sprout, growing, ripe\n' +
        "XS = [60, 150, 240, 330, 420]\n" +
        "GY = 300\n" +
        "\n" +
        'coins = game.load("coins", 8)              # 8 the very first run\n' +
        'plots = game.load("plots", [0, 0, 0, 0, 0])\n' +
        "if len(plots) != 5:\n" +
        "    plots = [0, 0, 0, 0, 0]\n" +
        "\n" +
        'game.box(240, 350, 480, 80, "#6bbf59")     # grass strip along the bottom\n' +
        "crops = [game.sprite(STAGES[plots[i]], XS[i], GY, size=56) for i in range(5)]\n" +
        "# Labels sit centred on their (x, y), so give them the middle of the\n" +
        "# window, not the left edge, or the text runs off the side.\n" +
        'board = game.label("Coins: " + str(coins), 70, 24, size=24,\n' +
        '                   color="#20242e", background="#ffffff")\n' +
        'game.label("Click a plot: plant (-2) or harvest ripe (+5).  Press R to reset.",\n' +
        '           240, 342, size=13, color="#20242e", background="#ffffff")\n' +
        "\n" +
        "def refresh():\n" +
        "    for i in range(5):\n" +
        "        crops[i].content = STAGES[plots[i]]\n" +
        '    board.content = "Coins: " + str(coins)\n' +
        "\n" +
        "grow = 0\n" +
        "while game.playing():\n" +
        '    if game.pressed("r"):                      # wipe the save, start over\n' +
        "        coins, plots = 8, [0, 0, 0, 0, 0]\n" +
        "        game.clear_save()\n" +
        "        refresh()\n" +
        "\n" +
        "    if game.clicked():                         # plant an empty plot or harvest a ripe one\n" +
        "        mx, my = game.mouse_x(), game.mouse_y()\n" +
        "        for i in range(5):\n" +
        "            if abs(mx - XS[i]) < 44 and abs(my - GY) < 48:\n" +
        "                if plots[i] == 0 and coins >= COST:\n" +
        "                    coins -= COST\n" +
        "                    plots[i] = 1\n" +
        '                    game.sound("powerup")\n' +
        "                elif plots[i] == 3:\n" +
        "                    coins += REWARD\n" +
        "                    plots[i] = 0\n" +
        '                    game.sound("coin")\n' +
        '                game.save("coins", coins)      # save the moment it changes\n' +
        '                game.save("plots", plots)\n' +
        "                refresh()\n" +
        "                break\n" +
        "\n" +
        "    grow += 1                                  # plants ripen slowly\n" +
        "    if grow >= 180:                            # about 3 seconds at 60 fps\n" +
        "        grow = 0\n" +
        "        ready = [i for i in range(5) if 1 <= plots[i] <= 2]\n" +
        "        if ready:\n" +
        "            i = random.choice(ready)\n" +
        "            plots[i] += 1\n" +
        '            game.save("plots", plots)\n' +
        "            refresh()\n" +
        "\n" +
        "    game.frame(60)\n"
    },
    {
      title: "Your first 3D scene",
      desc: "import game3d. A spinning cube on a green field. Change a number, hit Run, see what happens.",
      cat: "3D",
      code:
        "import game3d\n" +
        "\n" +
        "# A 3D world: x is right, y is up, z is towards you.\n" +
        'game3d.background("#8ec5f0")      # the sky\n' +
        'game3d.ground(40, color="#3f8f4f")  # the floor\n' +
        "\n" +
        "# Make a cube, half its height above the ground so it sits on top.\n" +
        'cube = game3d.box(0, 0.5, 0, color="#e2483d")\n' +
        'ball = game3d.sphere(3, 1, -2, size=1.4, color="#f6c945")\n' +
        "\n" +
        "# Where the camera stands, and what it looks at.\n" +
        "game3d.camera(0, 5, 10, look_at=(0, 0, 0))\n" +
        "\n" +
        "while True:\n" +
        "    cube.spin(ry=2)      # turn 2 degrees around the up axis\n" +
        "    ball.spin(rx=3)\n" +
        "    game3d.frame(60)\n"
    },
    {
      title: "Collect the coins",
      desc: "Drive the red cube with the arrow keys and grab the gold spheres. Real 3D, same game loop you already know.",
      cat: "3D",
      code:
        "import game3d\n" +
        "\n" +
        "game3d.background(\"#8ec5f0\")\n" +
        "game3d.ground(60, color=\"#3f8f4f\")\n" +
        "\n" +
        "player = game3d.box(0, 0.5, 0, color=\"#e2483d\")\n" +
        "game3d.camera(follow=player, distance=11, height=7)\n" +
        "\n" +
        "# Scatter some coins to collect.\n" +
        "coins = []\n" +
        "for i in range(8):\n" +
        "    coins.append(game3d.sphere(i * 5 - 17, 0.7, -6 - (i % 3) * 5, size=1.1))\n" +
        "\n" +
        "score = 0\n" +
        "while True:\n" +
        '    if game3d.pressed("left"):  player.x = player.x - 0.25\n' +
        '    if game3d.pressed("right"): player.x = player.x + 0.25\n' +
        '    if game3d.pressed("up"):    player.z = player.z - 0.25\n' +
        '    if game3d.pressed("down"):  player.z = player.z + 0.25\n' +
        "    player.spin(ry=3)\n" +
        "\n" +
        "    for c in list(coins):\n" +
        "        c.spin(ry=2)\n" +
        "        if player.touches(c):\n" +
        "            c.remove()\n" +
        "            coins.remove(c)\n" +
        "            score = score + 1\n" +
        '            print("Coins:", score)\n' +
        "\n" +
        "    game3d.frame(60)\n"
    },
    {
      title: "Mouse synth",
      sub: "live sound",
      cat: "Tech Demo",
      desc: "A drone you play with the mouse: pitch follows left/right, volume follows up/down. One sustained tone, steered every frame, in about 20 lines.",
      code:
`import game

# A synth you play with the mouse. No audio files, no library: one tone,
# steered live. Move left and right for pitch, up and down for volume.
game.window(480, 300, background="#141026")
game.label("Move the mouse. Left/right = pitch, up/down = volume.",
           240, 30, size=16, color="#c9c2ff")

note = game.label("", 240, 150, size=44, color="#ffffff")
bar = game.box(240, 230, 8, 8, "#7c5cff")

drone = game.tone(220, "sawtooth", 0.0)   # starts silent

while game.playing():
    hz = 110 + game.mouse_x()             # 110 Hz on the left, ~590 on the right
    vol = 0.25 * (1 - game.mouse_y() / 300.0)
    if not game.mouse_in():
        vol = 0.0                         # quiet when the pointer leaves
    drone.pitch(hz)
    drone.volume(max(0.0, vol))

    note.content = str(int(hz)) + " Hz"
    bar.w = 8 + vol * 1200                # a VU meter, wider when louder
    bar.color = "#7c5cff" if vol > 0.01 else "#2a2350"
    game.frame(60)

drone.stop()`
    },
    {
      title: "Drag a slider",
      sub: "no widgets needed",
      cat: "Tech Demo",
      desc: "A working slider built from two boxes and a circle. Shows how far a handful of sprites and mouse_down() gets you.",
      code:
`import game

# A slider you can actually drag, built from two boxes and a circle.
game.window(480, 260, background="#101828")
game.label("Drag the knob", 240, 34, size=18, color="#9fb3d1")

LEFT, RIGHT, Y = 90, 390, 130
track = game.box((LEFT + RIGHT) // 2, Y, RIGHT - LEFT, 8, "#243146")
fill = game.box(LEFT, Y, 0, 8, "#4f9cff")
knob = game.circle(LEFT, Y, 34, color="#e8eefc")
read = game.label("0", 240, 200, size=40, color="#ffffff")

held = False

while game.playing():
    if game.mouse_down() and (knob.at_mouse() or held):
        held = True
        knob.x = max(LEFT, min(RIGHT, game.mouse_x()))
    if not game.mouse_down():
        held = False

    # The filled part grows from the left edge, so it has to move as it grows.
    fill.w = knob.x - LEFT
    fill.x = LEFT + fill.w / 2

    value = int((knob.x - LEFT) / (RIGHT - LEFT) * 100)
    read.content = str(value)
    game.frame(60)`
    },
    {
      title: "Bouncing ball",
      sub: "vs pygame",
      cat: "Tech Demo",
      desc: "The classic pygame bouncing ball, web-native. The real pygame version is commented at the top: same idea, but running it in a browser needs extra tooling like pygbag.",
      code:
        "# --- The real pygame version (works, but needs pygbag to run in a browser). ---\n" +
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
        'ball = game.circle(300, 200, 48, color="#e91e63")   # r=24, same as above\n' +
        "dx, dy = 2, 1.5\n" +
        "\n" +
        "while game.playing():\n" +
        "    ball.x = ball.x + dx\n" +
        "    ball.y = ball.y + dy\n" +
        "    if ball.x < 24 or ball.x > 576: dx = -dx\n" +
        "    if ball.y < 24 or ball.y > 376: dy = -dy\n" +
        "    game.frame(60)\n"
    },
    {
      title: "Catch the eggs",
      cat: "Basic Games",
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
        '    if game.pressed("left"):  basket.x = basket.x - 4\n' +
        '    if game.pressed("right"): basket.x = basket.x + 4\n' +
        "\n" +
        "    egg.y = egg.y + 2.5        # the egg falls\n" +
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
        "    game.frame(60)\n"
    },
    {
      title: "2-player shout-off",
      cat: "Basic Games",
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
        "DRAIN = 0.4      # how fast the bar leaks back down\n" +
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
        "    game.frame(60)\n"
    },
    {
      title: "Walk and turn around",
      cat: "Basic Games",
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
        "        runner.x = runner.x - 2.5\n" +
        "        runner.scale_x = -1    # mirror it to face left\n" +
        '    if game.pressed("right"):\n' +
        "        runner.x = runner.x + 2.5\n" +
        "        runner.scale_x = 1     # face right (the chicken's default)\n" +
        "    game.frame(60)\n"
    },
    {
      title: "Flappy bird",
      cat: "Advanced Games",
      desc: "Tap the screen (or SPACE) to flap. Gravity pulls you down, dodge the pipes, one point each.",
      code:
        "import game\n" +
        "import random\n" +
        "\n" +
        'game.window(480, 360, background="#4ec0ca")\n' +
        "\n" +
        "GRAVITY = 0.1      # pulls the bird down every frame\n" +
        "FLAP = -3.25       # a tap of space gives this much lift (up is negative)\n" +
        "GAP = 130          # the gap the bird flies through\n" +
        "SPEED = 2.4        # how fast the pipes slide left\n" +
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
        "    bird.angle = max(-25, min(70, vel * 10))\n" +
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
        "    game.frame(60)\n"
    },
    {
      title: "Drive a car",
      cat: "Basic Games",
      desc: "Top-down driving: arrows turn and drive, and it coasts to a stop.",
      code:
        "import game\n" +
        "import math\n" +
        "\n" +
        'game.window(480, 360, background="#3a7d3a")   # grass\n' +
        'car = game.sprite("car", 240, 180, size=64)\n' +
        "\n" +
        "speed = 0\n" +
        "TURN = 2          # degrees per press\n" +
        "POWER = 0.1       # how hard the pedal pushes\n" +
        "GRIP = 0.98       # below 1 means it slows down on its own\n" +
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
        "    game.frame(60)\n"
    },
    {
      title: "Grow a garden",
      cat: "Advanced Games",
      desc: "Drag a seed onto a plot, water it with the can, then snip the grown sunflower with the scissors for coins. Custom Asset-studio sprites throughout, with a two-frame scissor animation.",
      code:
`import game

# ===== setup ===============================================================
W, H = 960, 540
game.window(W, H, background="#8fce6e")

SPROUT, HERB, FLOWER = 15, 14, 33        # the three growth stages
SEEDS, CAN, CANWATER = 17, 20, 16        # seed pile, watering can, pouring can
HAND, GRAB, TROUGH = 21, 22, 30          # open hand, closed hand, planter
SNIP_OPEN, SNIP_SHUT = 12, 13            # the two halves of the scissor snip
game.preload(SPROUT, HERB, FLOWER, SEEDS, CAN, CANWATER, HAND, GRAB, TROUGH,
             SNIP_OPEN, SNIP_SHUT)

seeds = 5
coins = 0
PACK, PACK_COST, SELL_PRICE = 5, 8, 3

# ===== the plot row ========================================================
# Everything hangs off the planter, measured off the artwork rather than
# guessed. At size 164 its box is 164 x 86 and the paint runs from 28 ABOVE the
# sprite centre to 28 below, so RIM_Y is the one number to nudge: it is the
# visible rim line, and the soil, the plants and the pot all follow it.
PLOT_XS = [128, 304, 480, 656, 832]
TROUGH_SIZE = 164
TROUGH_RIM_UP = 28                       # sprite centre -> the painted top edge
RIM_Y = 286                              # <-- the one knob
TROUGH_Y = RIM_Y + TROUGH_RIM_UP

SOIL_W, SOIL_H = 150, 67                 # deep enough to fill the pot's mouth
SOIL_Y = TROUGH_Y - 8
SOIL_TOP = SOIL_Y - SOIL_H // 2          # where droplets land
PLANT_BASE = TROUGH_Y - 10               # every plant's feet sit on this line

# What draws in front of what: bigger sits on top. Labels start at 1000, so the
# droplets and the cursor are deliberately above that.
SOIL_LAYER, TROUGH_LAYER, PLANT_LAYER = 100, 900, 950
SEED_LAYER, DROP_LAYER, CURSOR_LAYER = 1200, 1500, 2000

# Each stage gets its own size band, so growth is obvious at a glance.
SPROUT_MIN, SPROUT_MAX = 40, 56
HERB_MIN, HERB_MAX = 69, 93
FLOWER_SIZE = 135

# ===== the screen ==========================================================
title = game.label("Grow a Sunflower", 150, 30, size=28,
                   color="#ffffff", background="#2f6b2f")
seed_lbl = game.label("Seeds: 5", 380, 30, size=24,
                      color="#ffffff", background="#2f6b2f")
coin_lbl = game.label("Coins: 0", 540, 30, size=24,
                      color="#3a2e0a", background="#ffd75e")
buy_btn = game.box(790, 30, 240, 44, "#8a4a12")
buy_lbl = game.label("BUY 5 SEEDS (8 coins)", 790, 30, size=18, color="#ffe9a8")

# Soil first, so the dirt draws under everything else.
plots = []
for px in PLOT_XS:
    soil = game.box(px, SOIL_Y, SOIL_W, SOIL_H, "#9c6b3f")
    soil.layer = SOIL_LAYER
    plots.append({"soil": soil, "x": px, "plant": None,
                  "planted": False, "growth": 0.0, "wet": 0.0})

for plot in plots:                       # plants above the planter panel
    plot["plant"] = game.sprite("", plot["x"], PLANT_BASE, size=SPROUT_MIN)
    plot["plant"].anchor = (0.5, 1.0)    # the handle is its FEET, not its middle
    plot["plant"].layer = PLANT_LAYER

for plot in plots:                       # planter over the dirt
    frame = game.sprite(TROUGH, plot["x"], TROUGH_Y, size=TROUGH_SIZE, asset=True)
    frame.layer = TROUGH_LAYER

# The seed you drag out of the tray.
TRAY_X, TRAY_Y = 74, 150
seed = game.sprite(SEEDS, TRAY_X, TRAY_Y, size=51, asset=True)
seed.layer = SEED_LAYER

game.label("Drag a seed onto soil. Click to water. Snip a grown sunflower to sell it.",
           480, H - 26, size=19, color="#ffffff", background="#2f6b2f")

# Three droplets, reused for every pour.
drops = [game.sprite("💧", 0, 0, size=20) for _ in range(3)]
for d in drops:
    d.layer = DROP_LAYER
    d.hide()

# The cursor is made LAST and sits on top of everything.
can = game.sprite(CAN, 480, 270, size=60, asset=True)
can.layer = CURSOR_LAYER
game.hide_cursor()

# Where each tool's point sits inside its own box, as a fraction: (0, 0) is the
# top-left corner, (0.5, 0.5) the middle.
ORIGIN = {CAN: (0.00, 0.30), CANWATER: (0.00, 0.30),
          GRAB: (0.50, 0.50), HAND: (0.30, 0.15),
          SNIP_OPEN: (0.50, 0.45), SNIP_SHUT: (0.50, 0.45)}   # the blade pivot
SPOUT = (0.12, 0.70)                     # where the water leaves the can

holding = False


# ===== helpers =============================================================
def follow_mouse():
    # Must be called by hand inside any animation that runs its own frames,
    # or the cursor freezes while the mouse keeps moving.
    ox, oy = ORIGIN.get(can.asset, (0.5, 0.5))
    can.x = game.mouse_x() + (0.5 - ox) * can.size
    can.y = game.mouse_y() + (0.5 - oy) * can.size


def set_cursor(asset):
    can.asset = asset
    follow_mouse()


def stand(plant, size):
    # Feet on the same line every time. The plants are anchored at (0.5, 1.0),
    # so y IS the ground line and there is nothing to work out. Taking half the
    # size instead only works for square art: size is the LONGER side, so a wide
    # sprite would float above the soil.
    plant.size = size
    plant.y = PLANT_BASE


def soil_color(wet):
    t = max(0.0, min(1.0, wet / 100.0))
    r = int(0x9c + (0x5c - 0x9c) * t)
    g = int(0x6b + (0x38 - 0x6b) * t)
    b = int(0x3f + (0x1c - 0x3f) * t)
    return "#%02x%02x%02x" % (r, g, b)


def look(plot):
    g, plant = plot["growth"], plot["plant"]
    if g >= 100:
        plant.asset = FLOWER
        stand(plant, FLOWER_SIZE)
    elif g >= 45:
        plant.asset = HERB
        stand(plant, HERB_MIN + (HERB_MAX - HERB_MIN) * (g - 45) / 55.0)
    else:
        plant.asset = SPROUT
        stand(plant, SPROUT_MIN + (SPROUT_MAX - SPROUT_MIN) * g / 45.0)


def ready_under_mouse():
    # True while the pointer is over a sunflower that has finished growing.
    for plot in plots:
        if plot["planted"] and plot["growth"] >= 100 and (
                plot["plant"].at_mouse() or plot["soil"].at_mouse()):
            return True
    return False


def snip():
    # Two quick closes of the blades before the flower comes off, so cutting it
    # reads as a cut. Swapping between two sprites IS the animation.
    for _ in range(2):
        for blade in (SNIP_SHUT, SNIP_OPEN):
            set_cursor(blade)
            for _ in range(3):
                follow_mouse()
                game.frame()


def plant_seed(plot):
    global seeds
    seeds = seeds - 1
    plot["planted"] = True
    plot["growth"] = 1.0
    plot["wet"] = 0.0                    # goes in dry: watering is your job
    look(plot)
    seed_lbl.content = "Seeds: " + str(seeds)
    game.sound(4)


def water_pour(plot):
    # Swap in the pouring can and run droplets down onto the soil while the
    # dirt darkens, so the plot fills up rather than jumping to wet.
    start = plot["wet"]
    set_cursor(CANWATER)
    for step in range(10):
        t = (step + 1) / 10.0
        plot["wet"] = start + (100.0 - start) * t
        plot["soil"].color = soil_color(plot["wet"])
        sx = can.x + (SPOUT[0] - 0.5) * can.size
        sy = can.y + (SPOUT[1] - 0.5) * can.size
        for i, d in enumerate(drops):
            dt = ((step + i * 3) % 10) / 10.0     # staggered, so it reads as a stream
            d.show()
            d.x = sx + (plot["x"] - sx) * dt
            d.y = sy + (SOIL_TOP - sy) * dt + 14 * dt * dt
            d.size = 20 - 8 * dt
        follow_mouse()
        game.frame()
    for d in drops:
        d.hide()
    set_cursor(CAN)
    plot["wet"] = 100.0
    plot["soil"].color = soil_color(100.0)


def sell_pop(plant):
    # A hop before the sunflower vanishes, sized off the sprite itself.
    base_y, base_size = plant.y, plant.size
    for step in range(8):
        t = step / 7.0
        arc = 4 * t * (1 - t)                    # 0 -> 1 -> 0
        plant.y = base_y - arc * base_size * 0.35
        plant.size = base_size + arc * base_size * 0.14
        follow_mouse()
        game.frame()
    plant.y, plant.size = base_y, base_size


def sell(plot):
    global coins
    snip()                                   # cut it free first
    game.sound(2)
    sell_pop(plot["plant"])
    coins = coins + SELL_PRICE
    coin_lbl.content = "Coins: " + str(coins)
    plot["planted"] = False
    plot["growth"] = 0.0
    plot["plant"].content = ""               # clears the asset off
    stand(plot["plant"], SPROUT_MIN)


def buy_seeds():
    global seeds, coins
    stuck = seeds == 0 and not any(p["planted"] for p in plots)
    if coins >= PACK_COST:
        coins = coins - PACK_COST
        seeds = seeds + PACK
        game.sound(3)
    elif stuck:
        seeds = seeds + 1                    # a free one, so you can never lose
        game.sound(2)
    else:
        game.sound(1)
    seed_lbl.content = "Seeds: " + str(seeds)
    coin_lbl.content = "Coins: " + str(coins)


# ===== the game loop =======================================================
while game.playing():
    click = game.clicked()
    follow_mouse()

    # Plots dry out; a plant only grows while its plot is still wet.
    for plot in plots:
        if plot["wet"] > 0:
            plot["wet"] = max(0.0, plot["wet"] - 0.5)
            plot["soil"].color = soil_color(plot["wet"])
        if plot["planted"] and plot["wet"] > 0 and plot["growth"] < 100:
            plot["growth"] = min(100.0, plot["growth"] + 0.4)
            look(plot)

    # Drag a seed from the tray onto a plot.
    if game.mouse_down():
        if not holding and seeds > 0 and seed.at_mouse():
            holding = True
        if holding:
            seed.x, seed.y = game.mouse_x(), game.mouse_y()
    elif holding:
        for plot in plots:
            if not plot["planted"] and seed.touches(plot["soil"]):
                plant_seed(plot)
                break
        seed.x, seed.y = TRAY_X, TRAY_Y
        holding = False

    # A click: buy seeds, water a plant, or sell a grown sunflower.
    if click:
        if buy_btn.at_mouse():
            buy_seeds()
        else:
            for plot in plots:
                # Anywhere on the pot counts, so a tiny sprout is easy to hit.
                if plot["planted"] and (plot["plant"].at_mouse() or plot["soil"].at_mouse()):
                    if plot["growth"] >= 100:
                        sell(plot)
                    else:
                        game.sound(0)
                        water_pour(plot)
                    break

    seed.asset = SEEDS if seeds > 0 else ""  # nothing to drag once you run out

    # The cursor shows what you are doing.
    if holding:
        set_cursor(GRAB)
    elif seed.at_mouse() or buy_btn.at_mouse():
        set_cursor(HAND)
    elif ready_under_mouse():
        set_cursor(SNIP_OPEN)                # ready to cut
    else:
        set_cursor(CAN)

    game.frame(60)`
    },
    {
      title: "Asteroids",
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
        r.vx = random.uniform(-0.8, 0.8)
        r.vy = random.uniform(-0.8, 0.8)
        r.big = True
        rocks.append(r)

def split(rock):
    # A big rock breaks into two fast little ones.
    for i in range(2):
        s = game.sprite("asteroid", rock.x, rock.y, size=26)
        s.vx = random.uniform(-1.2, 1.2)
        s.vy = random.uniform(-1.2, 1.2)
        s.big = False
        rocks.append(s)

spawn_wave()

while game.playing():
    # ---- steer and thrust ----
    if game.pressed("left"):  heading = heading - 2.5
    if game.pressed("right"): heading = heading + 2.5
    a = heading * math.pi / 180
    if game.pressed("up"):
        vx = vx + math.cos(a) * 0.0625
        vy = vy + math.sin(a) * 0.0625
    vx = vx * 0.9925           # a whisper of drag so it stays flyable
    vy = vy * 0.9925
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
        b.vx = math.cos(a) * 4.5 + vx
        b.vy = math.sin(a) * 4.5 + vy
        bullets.append(b)
        cooldown = 14
        game.sound("laser")

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
                game.sound("explosion")
                break

    # ---- rocks hit the ship ----
    if safe > 0:
        safe = safe - 1
        ship.visible = (safe % 20) < 12   # blink while invincible
        if safe == 0:
            ship.visible = True
    else:
        for r in rocks:
            if ship.touches(r):
                lives = lives - 1
                game.sound("hit")
                update_board()
                if lives == 0:
                    game.submit_score(score)   # leaderboard, if you publish it!
                    game.game_over("Game over! Score: " + str(score))
                ship.x = W // 2
                ship.y = H // 2
                vx = 0.0
                vy = 0.0
                safe = 180
                break

    # ---- wave cleared? a bigger one arrives ----
    if len(rocks) == 0:
        spawn_wave()

    game.frame(60)`
    },
    {
      title: "Whack a mouse",
      cat: "Basic Games",
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
        '        holes.append(game.circle(120 + col * 120, 130 + row * 95, 70, 22,\n' +
        '                                 color="#3d2a1a"))\n' +
        "\n" +
        'mole = game.sprite("mouse", 120, 116, size=48)\n' +
        "score = 0\n" +
        "timer = 0\n" +
        "\n" +
        "while game.playing():\n" +
        "    timer = timer + 1\n" +
        "    # Time to scurry! The higher your score, the faster it moves.\n" +
        "    if timer >= max(20, 60 - score * 2):\n" +
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
        "    game.frame(60)\n"
    },
    {
      title: "Drag and drop",
      cat: "Basic Games",
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
        "    game.frame(60)\n"
    },
    {
      title: "3D maze",
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
        '    if game.pressed("left"):  pa = pa - 0.035\n' +
        '    if game.pressed("right"): pa = pa + 0.035\n' +
        "    step = 0\n" +
        '    if game.pressed("up"):    step = 0.06\n' +
        '    if game.pressed("down"):  step = -0.06\n' +
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
        "    game.frame(60)\n"
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
      title: "Christmas tree",
      sub: "animated",
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
      title: "Flappy",
      sub: "made for phones",
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

space_was = False                       # so HOLDING space is one flap, not a spam
while game.playing():
    space_now = game.pressed("space")
    if game.clicked() or (space_now and not space_was):
        vy = FLAP
        if not started:
            started = True
            tip.hide()
        game.sound("jump")
    space_was = space_now

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
                game.game_over("Score " + str(game.score()) + " - tap to play again", retry=True)
        if bird.touches(ground) or bird.y < 0:
            game.sound("hit")
            game.submit_score(game.score())
            game.game_over("Score " + str(game.score()) + " - tap to play again", retry=True)

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
    // \b so "import game3d" doesn't also open the 2D game window.
    return /(^|\n)\s*(import\s+game\b|from\s+game\s+import)/.test(code || "");
  }
  function usesGame3d(code) {
    return /(^|\n)\s*(import\s+game3d|from\s+game3d\s+import)/.test(code || "");
  }
  function updatePanels(code) {
    const src = code == null ? runner.getCode() : code;
    const tp = document.getElementById("turtle-panel");
    if (tp) tp.hidden = !usesTurtle(src);
    const gp = document.getElementById("game-panel");
    if (gp) gp.hidden = !usesGame(src);
    const sp = document.getElementById("game3d-panel");
    if (sp) sp.hidden = !usesGame3d(src);
  }

  const runner = window.PyRun.create({
    editor: editor,
    output: output,
    runBtn: runBtn,
    storageKey: STORAGE_KEY,
    defaultCode: DEFAULT_CODE,
    onChange: function (code) { updatePanels(code); },
    onRunStart: function () {
      // A maximised editor covers the whole screen, hiding the output / game
      // window it just ran. Drop back to the split view so you can watch it run
      // straight away, instead of having to minimise the code by hand.
      if (editorPanel && editorPanel.classList.contains("is-max")) setMaximised(false);
      // Give the game canvas focus so the arrow keys reach it immediately.
      if (usesGame(runner.getCode())) {
        const cv = document.getElementById("game-canvas");
        if (cv) cv.focus();
        // Warm any user-made asset sprites the code names, so they don't pop in.
        try {
          const ids = [], re = /game\.sprite\(\s*(\d+)[^)]*asset\s*=\s*True/g;
          const code = runner.getCode();
          let m;
          while ((m = re.exec(code))) ids.push(m[1]);
          if (ids.length && window.PWL && window.PWL.preloadGameAssets) window.PWL.preloadGameAssets(ids);
        } catch (e) {}
      }
    },
    turtle: {
      canvas: document.getElementById("turtle-canvas"),
      sprite: document.getElementById("turtle-sprite")
    },
    game: {
      canvas: document.getElementById("game-canvas")
    },
    game3d: {
      canvas: document.getElementById("game3d-canvas")
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

    // The output column's OWN height, not its grid-stretched offsetHeight. The
    // shell is a two-column grid with align-items: stretch, so both columns are
    // sized to the taller one. Reading right.offsetHeight here would couple the
    // cap back to the editor: a taller editor stretches `right`, whose resize
    // (via the ResizeObserver below) grows --code-cap, which lets the editor
    // show more, which stretches `right` again — a feedback loop that ratchets
    // the editor open to its full height on the first edit/backspace. Summing
    // the visible panels sidesteps the stretch and stays stable.
    function rightNaturalHeight() {
      const cs = getComputedStyle(right);
      const gap = parseFloat(cs.rowGap) || parseFloat(cs.gap) || 0;
      let total = 0, shown = 0;
      for (let i = 0; i < right.children.length; i++) {
        const h = right.children[i].offsetHeight;
        if (h > 0) { total += h; shown++; }   // hidden panels report 0
      }
      if (shown > 1) total += gap * (shown - 1);
      return total;
    }
    function measureCap() {
      // Single column (phones): a plain viewport-based cap. Two columns: match
      // the output side so the code never towers over the game/output boxes.
      if (isMobile()) { editorPanel.style.setProperty("--code-cap", "62vh"); return; }
      const barH = bar ? bar.offsetHeight : 44;
      const cap = Math.max(240, Math.round(rightNaturalHeight() - barH));
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

    // The expand pill now runs Maximise (same as the Maximise button). The old
    // vertical grow shoved the whole page height around; maximise is cleaner.
    expandBtn.addEventListener("click", function () {
      setMaximised(!editorPanel.classList.contains("is-max"));
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
      // The on-screen X leaves fullscreen AND ends the program, so a fullscreen
      // game (where the Stop button is hidden behind it) can always be quit.
      if (window.PWL && window.PWL.setGameFullscreen) window.PWL.setGameFullscreen(false);
      if (window.PWL && window.PWL.stopRun) window.PWL.stopRun();
    });
  })();

  // Snippets sit two levels deep: plain Python you could run anywhere, then the
  // things that only work here. Stock Python starts collapsed, so what you see
  // first is the browser-only fun (turtle, games, 3D) rather than print().
  const EXAMPLE_SECTIONS = [
    // Every category starts closed, so the whole menu is a short list you scan
    // rather than a wall of cards you scroll past.
    { name: "Stock Python", open: false, subOpen: false, cats: ["Basic", "Intermediate"] },
    { name: "PyWebLib", open: true, subOpen: false,
      cats: ["Turtle", "Basic Games", "Multiplayer", "Advanced Games", "3D", "Tech Demo", "Coloured Text"] }
  ];

  // Work out which category a snippet belongs in. An explicit ex.cat wins;
  // otherwise anything that colours its output is Coloured Text and the rest
  // is Basic. Titles used to carry a "Game: " / "Turtle: " prefix that this
  // read, but the section heading above the card already says that, so the
  // prefix went and those snippets name their category outright instead.
  function categoryOf(ex) {
    if (ex.cat) return ex.cat;
    if (/\bcol\s*=/.test(ex.code)) return "Coloured Text";
    return "Basic";
  }

  function renderExamples() {
    const wrap = document.getElementById("sandbox-examples");
    if (!wrap) return;
    wrap.innerHTML = "";
    EXAMPLE_SECTIONS.forEach(function (sec) {
      // Only the categories that actually have snippets, so an empty one never
      // shows up as a dead heading.
      const cats = sec.cats.filter(function (cat) {
        return EXAMPLES.some(function (ex) { return categoryOf(ex) === cat; });
      });
      if (!cats.length) return;
      const total = EXAMPLES.filter(function (ex) {
        return cats.indexOf(categoryOf(ex)) >= 0;
      }).length;

      const section = document.createElement("details");
      section.className = "sandbox-example-section";
      section.open = !!sec.open;
      const secSummary = document.createElement("summary");
      secSummary.innerHTML = escapeHtml(sec.name) +
        '<span class="sandbox-example-count">' + total + '</span>';
      section.appendChild(secSummary);

      cats.forEach(function (cat) {
        const items = EXAMPLES.filter(function (ex) { return categoryOf(ex) === cat; });

        const group = document.createElement("details");
        group.className = "sandbox-example-group";
        group.open = !!sec.subOpen;

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
          // An optional subtitle keeps the qualifier ("vs pygame") out of the
          // title, so the name stays short enough to read at a glance.
          btn.innerHTML =
            '<span class="sandbox-example-title">' + escapeHtml(ex.title) +
              (ex.sub ? '<span class="sandbox-example-sub">' + escapeHtml(ex.sub) + '</span>' : "") +
            '</span>' +
            '<span class="sandbox-example-desc">' + escapeHtml(ex.desc) + '</span>';
          btn.addEventListener("click", function () {
            loadInto(ex.code, 'Loaded "' + ex.title + '"');
            editor.scrollIntoView({ behavior: "smooth", block: "start" });
          });
          grid.appendChild(btn);
        });
        group.appendChild(grid);
        section.appendChild(group);
      });
      wrap.appendChild(section);
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
