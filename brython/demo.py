import game
import random
import math

# 1. Setup the browser window layout
game.window(480, 360, background="#87ceeb")

# Core Game Variables
BLOCK_SIZE = 24
WORLD_WIDTH = 20
WORLD_HEIGHT = 15

# Color mappings
BIOME_COLORS = {
    "forest": {
        "bg": "#87ceeb", "grass": "#228b22", "dirt": "#9b7653", "stone": "#808080",
        "trunk": "#5c4033", "leaves": "#2e8b57", "enemy": "#32cd32"
    },
    "desert": {
        "bg": "#f4a460", "grass": "#eedd82", "dirt": "#d2b48c", "stone": "#bc8f8f",
        "trunk": "#8b4513", "leaves": "#006400", "enemy": "#ff8c00"
    },
    "underworld": {
        "bg": "#1a0000", "grass": "#8b0000", "dirt": "#4a0000", "stone": "#000000",
        "trunk": "#ff4500", "leaves": "#ff8c00", "enemy": "#ff0000"
    }
}

current_biome = "forest"
blocks = []
enemies = []
bullets = []

# 2. Procedural Generation Function
def generate_world(biome_name):
    global blocks, enemies, bullets
    for b in blocks: b.remove()
    for e in enemies: e.remove()
    for bl in bullets: bl.remove()
    blocks, enemies, bullets = [], [], []
    
    game.window(480, 360, background=BIOME_COLORS[biome_name]["bg"])
    colors = BIOME_COLORS[biome_name]
    
    surface_y = 7 if biome_name != "underworld" else 5
        
    for x in range(WORLD_WIDTH):
        surface_y += random.choice([-1, 0, 1])
        surface_y = max(4, min(surface_y, 11))
        surface_pos_y = 0
        
        for y in range(WORLD_HEIGHT):
            pos_x = x * BLOCK_SIZE + (BLOCK_SIZE // 2)
            pos_y = y * BLOCK_SIZE + (BLOCK_SIZE // 2)
            
            if y == surface_y:
                b = game.box(pos_x, pos_y, BLOCK_SIZE, BLOCK_SIZE, colors["grass"])
                blocks.append(b)
                surface_pos_y = pos_y
            elif y > surface_y and y < surface_y + 3:
                b = game.box(pos_x, pos_y, BLOCK_SIZE, BLOCK_SIZE, colors["dirt"])
                blocks.append(b)
            elif y >= surface_y + 3:
                if y == WORLD_HEIGHT - 1 and biome_name != "underworld" and random.random() < 0.3:
                    continue 
                b = game.box(pos_x, pos_y, BLOCK_SIZE, BLOCK_SIZE, colors["stone"])
                blocks.append(b)
                
        # Spawn Trees
        if random.random() < 0.15 and x > 1 and x < WORLD_WIDTH - 2:
            for trunk_step in range(1, 4):
                tx = x * BLOCK_SIZE + (BLOCK_SIZE // 2)
                ty = surface_pos_y - (trunk_step * BLOCK_SIZE)
                blocks.append(game.box(tx, ty, BLOCK_SIZE, BLOCK_SIZE, colors["trunk"]))
            top_ty = surface_pos_y - (3 * BLOCK_SIZE)
            for lx, ly in [(0, -BLOCK_SIZE), (-BLOCK_SIZE, 0), (0, 0), (BLOCK_SIZE, 0), (0, BLOCK_SIZE)]:
                blocks.append(game.box(tx + lx, top_ty + ly, BLOCK_SIZE, BLOCK_SIZE, colors["leaves"]))

    # Spawn 3 Slime Enemies
    for _ in range(3):
        ex = random.randint(50, 430)
        ey = 50
        slime = game.box(ex, ey, 18, 14, color=colors["enemy"])
        slime.vy = 0
        enemies.append(slime)

generate_world(current_biome)

# 3. Create Player, Gun and UI
player = game.box(100, 50, 16, 24, color="#ff69b4")
player.layer = 5
gun = game.box(100, 50, 14, 5, color="#333333")
gun.layer = 6

travel_btn = game.label("Travel to Desert", 390, 20, size=12, color="#ffffff", background="#333333")
ui_health = game.label("HP: ❤️❤️❤️", 20, 20, size=12, color="#ff0000")
ui_ammo = game.label("Ammo: 6/6", 130, 20, size=12, color="#ffff00")
travel_btn.layer = ui_health.layer = ui_ammo.layer = 1001

# Gameplay Stats
stats = {"hp": 3, "ammo": 6, "reload_timer": 0, "shoot_cooldown": 0, "invuln": 0}
physics = {"vy": 0, "gravity": 0.4, "speed": 3}

# 4. Main Game Loop
while game.playing():
    # Timers
    if stats["shoot_cooldown"] > 0: stats["shoot_cooldown"] -= 1
    if stats["invuln"] > 0: stats["invuln"] -= 1
    if stats["reload_timer"] > 0:
        stats["reload_timer"] -= 1
        if stats["reload_timer"] == 0:
            stats["ammo"] = 6
            ui_ammo.content = "Ammo: 6/6"

    # --- UNDERWORLD TRANSITION ---
    if player.y > 360:
        current_biome = "underworld" if current_biome != "underworld" else "forest"
        travel_btn.content = "Return to Overworld" if current_biome == "underworld" else "Travel to Desert"
        generate_world(current_biome)
        player.x, player.y, physics["vy"] = 240, 20, 0

    # --- POINT-AND-CLICK TRAVEL ---
    if travel_btn.at_mouse() and game.clicked():
        current_biome = "desert" if current_biome == "forest" else ("forest" if current_biome == "underworld" else "underworld")
        travel_btn.content = "Travel to Forest" if current_biome == "desert" else ("Travel to Desert" if current_biome == "forest" else "Return to Overworld")
        generate_world(current_biome)
        player.x, player.y, physics["vy"] = 100, 50, 0

    # --- HORIZONTAL MOVEMENT ---
    moved_x = 0
    if game.pressed("a") or game.pressed("left"): moved_x = -physics["speed"]
    if game.pressed("d") or game.pressed("right"): moved_x = physics["speed"]
    if moved_x != 0:
        player.x += moved_x
        for b in blocks:
            if player.touches(b): player.x -= moved_x

    # --- VERTICAL MOVEMENT & GRAVITY ---
    physics["vy"] = min(8, physics["vy"] + physics["gravity"])
    player.y += physics["vy"]
    on_ground = False
    for b in blocks:
        if player.touches(b):
            if physics["vy"] > 0:
                player.y -= physics["vy"]
                physics["vy"] = 0
                on_ground = True
            elif physics["vy"] < 0:
                player.y -= physics["vy"]
                physics["vy"] = 0
    if (game.pressed("w") or game.pressed("space")) and on_ground: physics["vy"] = -7

    # --- GUN LOGIC & MOUSE CLICKS ---
    gun.x, gun.y = player.x + 4, player.y + 2
    mx, my = game.mouse_x(), game.mouse_y()
    angle = math.atan2(my - gun.y, mx - gun.x)
    
    # Check mouse clicking triggers
    if game.clicked() and not travel_btn.at_mouse():
        colors = BIOME_COLORS[current_biome]
        
        # Action 1: Shift + Click to place blocks
        if game.pressed("shift"):
            grid_x = (mx // BLOCK_SIZE) * BLOCK_SIZE + (BLOCK_SIZE // 2)
            grid_y = (my // BLOCK_SIZE) * BLOCK_SIZE + (BLOCK_SIZE // 2)
            if not any(abs(b.x - grid_x) < 5 and abs(b.y - grid_y) < 5 for b in blocks):
                blocks.append(game.box(grid_x, grid_y, BLOCK_SIZE, BLOCK_SIZE, colors["grass"]))
                
        else:
            # Action 2: Check if click landed on a block to mine it
            mined_a_block = False
            for b in blocks[:]:
                if b.at_mouse():
                    b.remove()
                    blocks.remove(b)
                    mined_a_block = True
                    break
            
            # Action 3: Clicked in empty air -> Fire a Bullet!
            if not mined_a_block and stats["shoot_cooldown"] == 0 and stats["reload_timer"] == 0:
                if stats["ammo"] > 0:
                    stats["ammo"] -= 1
                    stats["shoot_cooldown"] = 12
                    ui_ammo.content = f"Ammo: {stats['ammo']}/6"
                    
                    bullet = game.box(gun.x, gun.y, 6, 4, color="#ffff00")
                    bullet.vx = math.cos(angle) * 7
                    bullet.vy = math.sin(angle) * 7
                    bullets.append(bullet)
                    
                    if stats["ammo"] == 0:
                        stats["reload_timer"] = 60
                        ui_ammo.content = "Reloading..."

    # --- BULLET PHYSICS ---
    for bl in bullets[:]:
        bl.x += bl.vx
        bl.y += bl.vy
        hit = False
        
        for e in enemies[:]:
            if bl.touches(e):
                e.remove()
                enemies.remove(e)
                hit = True
                break
        if not hit:
            for b in blocks:
                if bl.touches(b):
                    hit = True
                    break
        if hit or bl.x < 0 or bl.x > 480 or bl.y < 0 or bl.y > 360:
            bl.remove()
            bullets.remove(bl)

    # --- ENEMY AI ---
    for e in enemies:
        e.vy = min(8, e.vy + 0.4)
        e.y += e.vy
        for b in blocks:
            if e.touches(b) and e.vy > 0:
                e.y -= e.vy
                e.vy = 0
                if random.random() < 0.02: e.vy = -5 # Jump
                
        if e.x < player.x: e.x += 1
        else: e.x -= 1
        for b in blocks:
            if e.touches(b): e.x += 1 if e.x < b.x else -1
            
        if e.touches(player) and stats["invuln"] == 0:
            stats["hp"] -= 1
            stats["invuln"] = 45
            player.x += 20 if e.x < player.x else -20
            ui_health.content = "HP: " + "❤️" * max(0, stats["hp"])
            
            if stats["hp"] <= 0:
                stats["hp"] = 3
                ui_health.content = "HP: ❤️❤️❤️"
                player.x, player.y = 100, 50
                generate_world(current_biome)

    game.frame(60)
