import { Input } from './core/input';
import { Renderer } from './core/renderer';
import { Camera } from './core/camera';
import { Player } from './entities/player';
import { Projectile } from './entities/projectile';
import { Enemy } from './entities/enemies/enemy';
import { Recruiter } from './entities/enemies/recruiter';
import { Intern } from './entities/enemies/intern';

import { OutlookSwarm } from './entities/enemies/outlook-swarm';
import { AiBroStampede } from './entities/enemies/ai-bro-stampede';
import { OutlookInvite } from './entities/outlook-invite';
import { Pickup } from './entities/pickup';
import { Particle } from './entities/particle';
import { aabb } from './core/collision';
import { renderHud } from './systems/hud';
import { playSound, playMusic } from './core/sound';
import { soldierGunImg, soldierStandImg, drawSoldier, logoImg } from './core/assets';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import { GameState } from './types';
import { renderWorld, collidesWithWorld, worldRowToScreenY, END_AREA, findBuildingEdgeSpans, isBuildingBodyAt, checkDoorInteraction, initWorld, type DoorPortal } from './world';
import { AnnouncementSystem } from './systems/announcements';
import { WeaponType, WEAPONS } from './weapons';
import { GitContext, GitFile } from './git-context';

export class Game {
  private renderer: Renderer;
  private input: Input;
  private camera: Camera;
  private player: Player;
  private playerBullets: Projectile[] = [];
  private enemyBullets: Projectile[] = [];
  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];
  private particles: Particle[] = [];
  private state: GameState = 'title';
  private spawnTimer = 0;
  private outlookBossActive = false;

  private shakeTimer = 0;
  private shakeIntensity = 0;
  private popups: { text: string; x: number; y: number; timer: number }[] = [];
  private outlookInvites: OutlookInvite[] = [];
  private meetingModal: { name: string; age: number; acceptKey: string; declineKey: string } | null = null;
  private bossTitle = 0; // timer for boss title banner
  private bossName = 'OUTLOOK INVITES';
  private bossSubtitle = 'Shoot them down!';
  private bossColor = '#e94560';
  private deathTimer = 0;
  private deathX = 0;
  private deathY = 0;
  private deathAngle = -Math.PI / 2;
  private activeMountain: DoorPortal | null = null;

  private gameTime = 0;
  private rushHealTimer = 0;
  private meleeHitEnemies = new Set<Enemy>();
  private announcements = new AnnouncementSystem();

  // Guaranteed boss tracking — each spawns at least once per run
  private outlookBossSpawned = false;
  private aiBroSpawned = false;

  private showInfo = false;

  // Git integration
  private gitContext: GitContext | null;
  private gitFiles: GitFile[] = [];
  private resultSent = false;
  private gameRows = 3000;

  constructor(canvas: HTMLCanvasElement, gitContext: GitContext | null = null) {
    this.renderer = new Renderer(canvas);
    this.input = new Input();
    this.camera = new Camera();
    this.player = new Player();
    this.gitContext = gitContext;

    // In git mode, skip title and go straight to level-intro
    if (this.gitContext) {
      this.gitFiles = this.gitContext.payload.files;
      const linesAdded = this.gitContext.payload.linesAdded;
      const fileCount = this.gitFiles.length;
      if (this.gitContext.payload.gameRows) {
        this.gameRows = this.gitContext.payload.gameRows;
      } else {
        this.gameRows = Math.min(1520, Math.max(320,
          Math.floor(320 + fileCount * 72 + linesAdded * 0.2)
        ));
      }
      initWorld(this.gameRows);
      this.state = 'level-intro';
      this.setupGitHp();
    }
  }

  /** Map staged files to player HP (max 8 HP) */
  private setupGitHp(): void {
    const fileCount = this.gitFiles.length;
    const maxHp = Math.min(fileCount, 8);
    this.player.maxHp = maxHp;
    this.player.hp = maxHp;
  }

  /** Leave the mountain: drop back DOWN to the ground — the road beside the
   *  mountain base (where the door is), not up where the exit hole sits. */
  private exitMountain(): void {
    const p = this.player;
    const m = this.activeMountain;
    p.onMountain = false;
    this.activeMountain = null;
    if (m) {
      p.x = m.fieldCol * 16 + 8 - p.width / 2;
      // Land at the mountain base (door row) — ground level, on the road.
      let gy = worldRowToScreenY(m.doorRow, this.camera.y);
      // If the base scrolled off-screen, drop to the bottom of the field.
      if (gy < 16 || gy > CANVAS_HEIGHT - 16) gy = CANVAS_HEIGHT - p.height - 24;
      p.y = Math.max(8, Math.min(CANVAS_HEIGHT - p.height - 8, gy));
    }
    // Nudge down out of any solid tile we may have landed in.
    for (let i = 0; i < 32 && collidesWithWorld(p.x, p.y, p.width, p.height, this.camera.y); i++) {
      p.y += 1;
    }
  }

  update(dt: number): void {
    if (this.state === 'title') {
      if (this.input.fire || this.input.justPressed('Enter')) {
        this.state = 'playing';
        this.reset();
        playSound('select');
        playMusic();
      }
      // Scroll bg on title screen for effect
      this.camera.update(dt);
      this.input.endFrame();
      return;
    }

    if (this.state === 'level-intro') {
      if (this.input.anyJustPressed) {
        this.state = 'playing';
        this.reset();
        playSound('select');
        if (this.gitContext?.music !== false) playMusic();
      }
      this.input.endFrame();
      return;
    }

    if (this.state === 'game-over' || this.state === 'win') {
      if (!this.gitContext) {
        // Classic mode — return to title
        if (this.input.justPressed('Enter') || this.input.fire) {
          this.state = 'title';
          playSound('select');
        }
      }
      // In git mode, win/game-over screens are terminal (browser closes)
      this.input.endFrame();
      return;
    }

    if (this.state === 'dying') {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.state = 'game-over';
      }
      this.input.endFrame();
      return;
    }

    // Meeting modal — game keeps running, but player must accept/decline
    if (this.meetingModal) {
      this.meetingModal.age += dt;
      if (this.meetingModal.age > 0.4) {
        const aKey = this.meetingModal.acceptKey;
        const dKey = this.meetingModal.declineKey;
        if (this.input.justPressed(aKey) || this.input.isDown(aKey)) {
          this.meetingModal = null;
          playSound('select');
        } else if (this.input.justPressed(dKey) || this.input.isDown(dKey)) {
          this.meetingModal = null;
          this.player.score += 50;
          this.addPopup('+50 DECLINED', this.player.x + this.player.width / 2, this.player.y);
          playSound('coin', 0.3);
        }
      }
    }

    if (this.input.justPressed('KeyI')) this.showInfo = !this.showInfo;

    this.gameTime += dt;
    if (this.bossTitle > 0) this.bossTitle -= dt;

    // Update meeting zones
    this.announcements.update(dt, this.gameTime, this.camera.y);

    // Announcement shake
    const annShake = this.announcements.getIntroShake();
    if (annShake > 0) this.shake(0.15, annShake);

    this.player.handleInput(this.input);

    // Check if player is in an avoid zone — super slow
    if (this.announcements.isPlayerSlowed(this.player.x, this.player.y, this.player.width, this.player.height)) {
      this.player.vx *= 0.2;
      this.player.vy *= 0.2;
    }

    // Check if player reached a rush zone — bonus!
    const claimed = this.announcements.checkRushClaim(this.player.x, this.player.y, this.player.width, this.player.height);
    if (claimed) {
      this.player.score += 500;
      this.player.ammo = Math.min(99, this.player.ammo + 5);
      this.addPopup('+500 ESCAPED!', this.player.x + this.player.width / 2, this.player.y);
      playSound('coin', 0.3);
    }

    // Slowly heal while standing in a green (rush) zone
    if (this.announcements.isPlayerInRush(this.player.x, this.player.y, this.player.width, this.player.height)) {
      this.rushHealTimer += dt;
      if (this.rushHealTimer >= 1.5 && this.player.hp < this.player.maxHp) {
        this.rushHealTimer = 0;
        this.player.hp++;
        this.recoverGitFile();
        this.addPopup('HP+1', this.player.x + this.player.width / 2, this.player.y);
        playSound('coin', 0.2);
      }
    } else {
      this.rushHealTimer = 0;
    }

    // Shooting — fire in the direction the soldier faces; Q/E veer ±45°
    const wantFire = this.input.fire || this.input.fireLeft || this.input.fireRight;
    if (wantFire && this.player.canFire() && this.player.hasAmmo()) {
      let angle = this.player.angle; // facing direction
      if (this.input.fireLeft) angle -= Math.PI / 4;
      if (this.input.fireRight) angle += Math.PI / 4;
      this.playerBullets.push(...this.player.fire(angle));
      playSound('shoot', 0.15);
    }

    // Melee — dedicated key (X), available regardless of ammo
    if (this.input.melee && this.player.canMelee()) {
      this.player.melee();
      this.meleeHitEnemies.clear();
      playSound('shoot', 0.1);
    }

    // Check melee hits
    if (this.player.meleeTimer > 0) {
      const meleeBox = this.player.getMeleeBox();
      if (meleeBox) {
        for (const enemy of this.enemies) {
          if (!enemy.active) continue;
          if (this.meleeHitEnemies.has(enemy)) continue;
          if (aabb(meleeBox, enemy.getBounds())) {
            this.meleeHitEnemies.add(enemy);
            enemy.takeDamage(2);
            if (!enemy.active) {
              const pts = enemy.scoreValue * Math.max(1, this.player.streak);
              this.player.score += pts;
              this.player.streak++;
              this.addPopup(String(pts), enemy.x + enemy.width / 2, enemy.y);
              this.spawnExplosion(enemy.x, enemy.y);
              playSound('explosion', 0.25);
              this.maybeDropPickup(enemy.x, enemy.y);
            }
          }
        }
        for (const bullet of this.enemyBullets) {
          if (!bullet.active) continue;
          if (aabb(meleeBox, bullet.getBounds())) {
            bullet.active = false;
            this.addPopup('DEFLECT', bullet.x + bullet.width / 2, bullet.y);
          }
        }
        for (const invite of this.outlookInvites) {
          if (!invite.active) continue;
          if (aabb(meleeBox, invite.getBounds())) {
            invite.active = false;
            this.player.score += 50;
            this.player.streak++;
            this.addPopup('50 DECLINED', invite.x + invite.width / 2, invite.y);
          }
        }
      }
    }

    if (this.input.revert && this.player.gitRevertCharges > 0) {
      this.fireGitRevert();
    }

    // Slow scroll if player is near the bottom of the screen
    const p = this.player;
    const bottomMargin = CANVAS_HEIGHT - (p.y + p.height);
    if (bottomMargin < 40) {
      // Slow down camera when player is near bottom edge
      this.camera.speed = Math.max(8, 18 * (bottomMargin / 40));
    } else {
      this.camera.speed = 18;
    }

    // Save position, update, then check world collision
    const prevCameraY = this.camera.y;
    const prevX = p.x;
    const prevY = p.y;
    p.update(dt);

    const cx = () => p.x + p.width / 2;
    const cy = () => p.y + p.height / 2;

    if (p.onMountain) {
      // On the mountain: the body is walkable; constrain movement to body tiles.
      if (!isBuildingBodyAt(cx(), cy(), this.camera.y)) {
        p.x = prevX;
        p.y = prevY;
      }
      // Scroll continues; ride with the mountain (same as side-spawned enemies).
      this.camera.update(dt);
      p.y += this.camera.y - prevCameraY;

      // Reached the exit hole → drop back to the field.
      const m = this.activeMountain;
      if (m) {
        const hx = m.exitCol * 16;
        const hy = worldRowToScreenY(m.exitRow, this.camera.y);
        if (aabb({ x: p.x, y: p.y, w: p.width, h: p.height }, { x: hx, y: hy, w: 16, h: 16 })) {
          this.exitMountain();
        }
      }
      // Safety: never get trapped — eject if the body ended or we near the bottom.
      if (p.onMountain && (!isBuildingBodyAt(cx(), cy(), this.camera.y) || p.y + p.height > CANVAS_HEIGHT - 24)) {
        this.exitMountain();
      }
    } else {
      // Resolve player collision with world — try X and Y separately
      if (collidesWithWorld(p.x, prevY, p.width, p.height, this.camera.y)) {
        p.x = prevX;
      }
      if (collidesWithWorld(p.x, p.y, p.width, p.height, this.camera.y)) {
        p.y = prevY;
      }

      // Camera always scrolls
      this.camera.update(dt);

      // After scroll: check if player is now inside a solid tile (building came from above)
      if (collidesWithWorld(p.x, p.y, p.width, p.height, this.camera.y)) {
        for (let nudge = 1; nudge <= 16; nudge++) {
          p.y += 1;
          if (!collidesWithWorld(p.x, p.y, p.width, p.height, this.camera.y)) {
            break;
          }
        }
      }

      // Door interaction: press up at a door → enter and land on the mountain body
      if (this.input.up) {
        const portal = checkDoorInteraction(p.x, p.y, p.width, p.height, this.camera.y);
        if (portal) {
          p.onMountain = true;
          this.activeMountain = portal;
          p.x = portal.entryCol * 16 + 8 - p.width / 2;
          p.y = worldRowToScreenY(portal.entryRow, this.camera.y) + 8 - p.height / 2;
          playSound('select', 0.3);
        }
      }
    }

    // Check if player reached the end area — win!
    const endScreenY = worldRowToScreenY(END_AREA.row, this.camera.y);
    const endPxX = END_AREA.col * 16;
    const endPxW = END_AREA.w * 16;
    const endPxH = END_AREA.h * 16;
    if (
      endScreenY > -endPxH && endScreenY < CANVAS_HEIGHT &&
      p.x + p.width > endPxX && p.x < endPxX + endPxW &&
      p.y + p.height > endScreenY && p.y < endScreenY + endPxH
    ) {
      this.state = 'win';
      playSound('coin', 0.4);
      this.sendGitResult('win');
    }

    // If player is pushed off the bottom of the screen — death (safe while on a mountain)
    if (!p.onMountain && p.y + p.height > CANVAS_HEIGHT) {
      p.hp = 0;
      p.active = false;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
      const baseInterval = Math.max(1.5, 3.5 - this.gameTime * 0.015);
      this.spawnTimer = baseInterval + Math.random() * 2;
    }

    // How much the camera scrolled this frame (buildings shift down by this amount)
    const cameraScrollThisFrame = this.camera.y - prevCameraY;

    for (const enemy of this.enemies) {
      if ((enemy as any)._sideSpawn) {
        // Shift side-spawned enemies with the camera so they stay on their building
        enemy.y += cameraScrollThisFrame;
      }

      const ex = enemy.x;
      const ey = enemy.y;
      enemy.ai(dt, this.player.x + this.player.width / 2, this.player.y + this.player.height / 2);
      enemy.updateFlash(dt);

      if ((enemy as any)._sideSpawn) {
        // Side-spawned enemies bounce back when they leave building body tiles
        const cx = enemy.x + enemy.width / 2;
        const cy = enemy.y + enemy.height / 2;
        if (!isBuildingBodyAt(cx, cy, this.camera.y)) {
          enemy.x = ex;
          enemy.y = ey;
          enemy.vx = -enemy.vx;
          enemy.vy = -enemy.vy;
        }
        // Remove when scrolled off screen
        if (enemy.y > CANVAS_HEIGHT + 32) {
          enemy.active = false;
        }
      } else {
        // Top-spawned enemies bounce off solid tiles
        if (collidesWithWorld(enemy.x, enemy.y, enemy.width, enemy.height, this.camera.y)) {
          enemy.x = ex;
          enemy.y = ey;
          enemy.vx = -enemy.vx;
        }
      }

      if (enemy instanceof Recruiter && enemy.canFire()) {
        this.enemyBullets.push(
          enemy.fire(
            this.player.x + this.player.width / 2,
            this.player.y + this.player.height / 2
          )
        );
      }

      // Drain outlook invites from organizers
      if (enemy instanceof OutlookSwarm) {
        for (const invite of enemy.pendingInvites) {
          this.outlookInvites.push(invite);
        }
        enemy.pendingInvites = [];
      }
    }

    for (const inv of this.outlookInvites) inv.update(dt);
    for (const b of this.playerBullets) b.update(dt);
    for (const b of this.enemyBullets) b.update(dt);
    for (const p of this.pickups) p.update(dt);
    for (const p of this.particles) p.update(dt);

    // Collision: player bullets vs enemies
    for (const bullet of this.playerBullets) {
      if (!bullet.active) continue;
      for (const enemy of this.enemies) {
        if (!enemy.active) continue;
        if (aabb(bullet.getBounds(), enemy.getBounds())) {
          bullet.active = false;
          enemy.takeDamage(bullet.damage);
          playSound('hit', 0.2);
          if (!enemy.active) {
            const points = enemy.scoreValue * Math.max(1, this.player.streak);
            this.player.score += points;
            this.player.streak++;
            this.addPopup(String(points), enemy.x + enemy.width / 2, enemy.y);
            this.spawnExplosion(enemy.x, enemy.y);
            playSound('explosion', 0.25);
            this.maybeDropPickup(enemy.x, enemy.y);
          }
          break;
        }
      }
    }

    // Collision: player bullets vs outlook invites — shoot them down
    for (const bullet of this.playerBullets) {
      if (!bullet.active) continue;
      for (const invite of this.outlookInvites) {
        if (!invite.active) continue;
        if (aabb(bullet.getBounds(), invite.getBounds())) {
          bullet.active = false;
          invite.active = false;
          this.player.score += 25;
          this.addPopup('25', invite.x + invite.width / 2, invite.y);
          playSound('hit', 0.2);
          break;
        }
      }
    }

    // On the mountain the player is safe — skip all enemy/bullet damage.
    if (!this.player.onMountain) {
      for (const bullet of this.enemyBullets) {
        if (!bullet.active) continue;
        if (aabb(bullet.getBounds(), this.player.getBounds())) {
          bullet.active = false;
          if (this.player.takeDamage(1)) this.loseGitFile();
          this.shake(0.2, 3);
          playSound('hurt', 0.3);
        }
      }

      for (const enemy of this.enemies) {
        if (!enemy.active) continue;
        if (aabb(enemy.getBounds(), this.player.getBounds())) {
          if (this.player.takeDamage(1)) this.loseGitFile();
          this.shake(0.3, 4);
          playSound('hurt', 0.3);
        }
      }
    }

    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      if (aabb(pickup.getBounds(), this.player.getBounds())) {
        pickup.active = false;
        this.applyPickup(pickup);
        playSound('coin', 0.3);
      }
    }

    // Collision: player vs outlook invites — triggers meeting modal
    for (const invite of this.outlookInvites) {
      if (!invite.active) continue;
      if (aabb(invite.getBounds(), this.player.getBounds())) {
        invite.active = false;
        const [acceptKey, declineKey] = this.pickModalKeys();
        this.meetingModal = { name: invite.meetingName, age: 0, acceptKey, declineKey };
        this.shake(0.2, 6);
        playSound('hurt', 0.3);
        break;
      }
    }

    for (const p of this.popups) {
      p.timer -= dt;
      p.y -= 20 * dt;
    }
    this.popups = this.popups.filter((p) => p.timer > 0);

    if (this.shakeTimer > 0) this.shakeTimer -= dt;

    // Continuous shake while AI Bro Stampede is on screen
    for (const enemy of this.enemies) {
      if (enemy instanceof AiBroStampede && enemy.active) {
        this.shake(0.1, enemy.getShake());
        break;
      }
    }

    this.playerBullets = this.playerBullets.filter((b) => b.active);
    this.enemyBullets = this.enemyBullets.filter((b) => b.active);
    this.enemies = this.enemies.filter((e) => e.active);
    this.pickups = this.pickups.filter((p) => p.active);
    this.particles = this.particles.filter((p) => p.active);
    this.outlookInvites = this.outlookInvites.filter((i) => i.active);

    if (!this.player.active && this.state === 'playing') {
      this.state = 'dying';
      this.deathTimer = 2.0;
      this.deathX = this.player.x;
      this.deathY = this.player.y;
      this.deathAngle = this.player.angle;
      playSound('lose', 0.4);
      // Mark all remaining alive files as dead
      for (const f of this.gitFiles) f.alive = false;
      this.sendGitResult('loss');
    }

    this.input.endFrame();
  }

  render(_alpha: number): void {
    const ctx = this.renderer.ctx;
    this.renderer.clear();

    if (this.state === 'title') {
      this.renderTitle(ctx);
      return;
    }

    if (this.state === 'level-intro') {
      this.renderLevelIntro(ctx);
      return;
    }

    if (this.state === 'game-over') {
      if (this.gitContext) {
        this.renderGitGameOver(ctx);
      } else {
        this.renderGameOver(ctx);
      }
      return;
    }

    if (this.state === 'win') {
      if (this.gitContext) {
        this.renderGitWin(ctx);
      } else {
        this.renderWin(ctx);
      }
      return;
    }

    if (this.state === 'dying') {
      this.renderDying(ctx);
      return;
    }

    ctx.save();
    if (this.shakeTimer > 0) {
      const intensity = this.shakeIntensity;
      const sx = (Math.random() - 0.5) * intensity * 2;
      const sy = (Math.random() - 0.5) * intensity * 2;
      ctx.translate(sx, sy);
    }

    // World background
    renderWorld(ctx, this.camera.y);

    for (const p of this.pickups) p.render(ctx);
    for (const enemy of this.enemies) enemy.render(ctx);
    for (const b of this.enemyBullets) b.render(ctx);
    for (const inv of this.outlookInvites) inv.render(ctx);
    this.player.render(ctx);
    for (const b of this.playerBullets) b.render(ctx);
    for (const p of this.particles) p.render(ctx);

    for (const p of this.popups) {
      ctx.fillStyle = '#f7dc6f';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, p.timer * 2);
      ctx.fillText(`+${p.text}`, Math.round(p.x), Math.round(p.y));
      ctx.globalAlpha = 1;
    }


    ctx.restore();

    // Announcement overlay (rendered on top of game, under HUD)
    this.announcements.render(ctx);

    renderHud(ctx, this.player, this.gitContext ? this.gitFiles : null);

    if (this.showInfo) this.renderInfoOverlay(ctx);

    if (this.bossTitle > 0) {
      this.renderBossTitle(ctx);
    }

    if (this.meetingModal) {
      this.renderMeetingModal(ctx);
    }
  }

  private renderTitle(ctx: CanvasRenderingContext2D): void {
    renderWorld(ctx, this.camera.y);

    ctx.fillStyle = 'rgba(15, 15, 35, 0.8)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Logo — enable smoothing so the hi-res PNG scales cleanly (global flag is off for sprites)
    const logoW = 312;
    const logoH = 208;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logoImg, 154, 102, 1228, 820, (CANVAS_WIDTH - logoW) / 2, 8, logoW, logoH);
    ctx.imageSmoothingEnabled = false;

    // Alternate weapon/stand to simulate walking
    const walkImg = Math.floor(Date.now() / 400) % 2 === 0 ? soldierGunImg : soldierStandImg;
    drawSoldier(ctx, walkImg, CANVAS_WIDTH / 2, 228, -Math.PI / 2);

    ctx.fillStyle = '#bdc3c7';
    ctx.font = '6px monospace';
    ctx.fillText('Arrow keys / WASD - Move', CANVAS_WIDTH / 2, 272);
    ctx.fillText('Z / Space - Shoot', CANVAS_WIDTH / 2, 285);
    ctx.fillText('C - git revert (clear)', CANVAS_WIDTH / 2, 298);

    if (Math.floor(Date.now() / 500) % 2 === 0) {
      ctx.fillStyle = '#f5a623';
      ctx.font = '8px monospace';
      ctx.fillText('Press Z or ENTER to start', CANVAS_WIDTH / 2, 345);
    }

    ctx.fillStyle = '#533483';
    ctx.font = '6px monospace';
    ctx.fillText('$ git push origin main --force', CANVAS_WIDTH / 2, 372);
  }

  private renderGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#e94560';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, 120);

    ctx.fillStyle = '#ecf0f1';
    ctx.font = '7px monospace';
    ctx.fillText('Deliverable not shipped', CANVAS_WIDTH / 2, 145);

    // Dead character lying down
    drawSoldier(ctx, soldierGunImg, CANVAS_WIDTH / 2, 175, 0);

    ctx.fillStyle = '#f7dc6f';
    ctx.font = '8px monospace';
    ctx.fillText(`Score: ${this.player.score}`, CANVAS_WIDTH / 2, 210);

    ctx.fillStyle = '#7f8c8d';
    ctx.font = '6px monospace';
    ctx.fillText('$ git reset --hard HEAD', CANVAS_WIDTH / 2, 240);

    if (Math.floor(Date.now() / 500) % 2 === 0) {
      ctx.fillStyle = '#f5a623';
      ctx.font = '8px monospace';
      ctx.fillText('Press Z or ENTER to retry', CANVAS_WIDTH / 2, 310);
    }
  }

  private renderDying(ctx: CanvasRenderingContext2D): void {
    const progress = 1 - this.deathTimer / 2.0; // 0 → 1

    // Render the world underneath
    renderWorld(ctx, this.camera.y);
    for (const p of this.pickups) p.render(ctx);
    for (const enemy of this.enemies) enemy.render(ctx);

    // Blink fast then hold still and fade
    const fade = Math.max(0, 1 - progress * 1.2);
    const blinkFast = progress < 0.4 && Math.floor(progress * 20) % 2 === 0;

    if (!blinkFast) {
      ctx.save();
      ctx.globalAlpha = fade;
      const rx = Math.round(this.deathX);
      const ry = Math.round(this.deathY);

      // Tint red
      const dcx = rx + this.player.width / 2;
      const dcy = ry + this.player.height / 2;
      drawSoldier(ctx, soldierGunImg, dcx, dcy, this.deathAngle);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(233, 69, 96, ${0.5 * fade})`;
      ctx.fillRect(rx, ry, this.player.width, this.player.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    // Fade to black
    const blackFade = Math.min(1, progress * 1.0);
    ctx.fillStyle = `rgba(15, 15, 35, ${blackFade})`;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  private renderWin(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(5, 20, 10, 0.9)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#2ecc71';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DELIVERABLE SHIPPED', CANVAS_WIDTH / 2, 100);

    ctx.fillStyle = '#ecf0f1';
    ctx.font = '7px monospace';
    ctx.fillText('You survived the tech industry', CANVAS_WIDTH / 2, 130);

    drawSoldier(ctx, soldierGunImg, CANVAS_WIDTH / 2, 155, -Math.PI / 2);

    ctx.fillStyle = '#f7dc6f';
    ctx.font = '10px monospace';
    ctx.fillText(`Score: ${this.player.score}`, CANVAS_WIDTH / 2, 210);

    ctx.fillStyle = '#2ecc71';
    ctx.font = '6px monospace';
    ctx.fillText('$ git push origin main', CANVAS_WIDTH / 2, 245);
    ctx.fillText('Enumerating objects: done.', CANVAS_WIDTH / 2, 258);
    ctx.fillText('Writing objects: 100%, done.', CANVAS_WIDTH / 2, 271);
    ctx.fillText('remote: Deployed to production', CANVAS_WIDTH / 2, 284);

    if (Math.floor(Date.now() / 500) % 2 === 0) {
      ctx.fillStyle = '#f5a623';
      ctx.font = '8px monospace';
      ctx.fillText('Press Z or ENTER', CANVAS_WIDTH / 2, 330);
    }
  }

  private renderBossTitle(ctx: CanvasRenderingContext2D): void {
    const fade = Math.min(1, this.bossTitle * 2);
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 3;

    ctx.save();
    ctx.globalAlpha = fade;

    // Dark banner
    ctx.fillStyle = `rgba(10, 5, 30, 0.9)`;
    ctx.fillRect(0, cy - 28, CANVAS_WIDTH, 56);

    // Accent lines
    ctx.fillStyle = this.bossColor;
    ctx.fillRect(0, cy - 28, CANVAS_WIDTH, 2);
    ctx.fillRect(0, cy + 26, CANVAS_WIDTH, 2);

    // Title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px "Pixelify Sans", sans-serif';
    ctx.fillStyle = this.bossColor;
    ctx.fillText(this.bossName, cx, cy - 4);

    // Subtitle
    ctx.font = 'bold 10px "Pixelify Sans", sans-serif';
    ctx.fillStyle = '#ff8899';
    ctx.fillText(this.bossSubtitle, cx, cy + 18);

    ctx.restore();
  }

  private pickModalKeys(): [string, string] {
    // Pick two random distinct letter keys, avoiding WASD/movement keys
    const pool = 'BFGHIJKLMNOPQRTUVXY';
    const i = Math.floor(Math.random() * pool.length);
    let j = Math.floor(Math.random() * (pool.length - 1));
    if (j >= i) j++;
    return [`Key${pool[i]}`, `Key${pool[j]}`];
  }

  private renderMeetingModal(ctx: CanvasRenderingContext2D): void {
    if (!this.meetingModal) return;
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;

    // Dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Modal card
    const cardW = 220;
    const cardH = 160;
    const cardX = cx - cardW / 2;
    const cardY = cy - cardH / 2;

    // Card shadow
    ctx.fillStyle = 'rgba(0, 80, 180, 0.3)';
    ctx.fillRect(cardX + 3, cardY + 3, cardW, cardH);

    // Card background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(cardX, cardY, cardW, cardH);

    // Blue header bar
    ctx.fillStyle = '#0078d4';
    ctx.fillRect(cardX, cardY, cardW, 28);

    // Header icon + text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px "Pixelify Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Meeting Invite', cardX + 8, cardY + 14);

    // Meeting name
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px "Pixelify Sans", sans-serif';
    ctx.fillText(this.meetingModal.name, cx, cardY + 52);

    // Subtitle
    ctx.fillStyle = '#8899aa';
    ctx.font = '9px "Pixelify Sans", sans-serif';
    ctx.fillText('starts NOW - you cannot decline', cx, cardY + 72);
    ctx.fillText('Duration: 1 hour', cx, cardY + 86);

    // Separator
    ctx.strokeStyle = '#333355';
    ctx.beginPath();
    ctx.moveTo(cardX + 12, cardY + 98);
    ctx.lineTo(cardX + cardW - 12, cardY + 98);
    ctx.stroke();

    // Buttons with random keys
    const aLetter = this.meetingModal.acceptKey.replace('Key', '');
    const dLetter = this.meetingModal.declineKey.replace('Key', '');
    const btnW = 80;
    const btnH = 22;
    const btnY = cardY + 112;
    const blink = Math.floor(Date.now() / 400) % 2 === 0;

    // Accept button
    const acceptX = cx - btnW - 8;
    ctx.fillStyle = '#0078d4';
    ctx.fillRect(acceptX, btnY, btnW, btnH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px "Pixelify Sans", sans-serif';
    ctx.fillText(`Accept [${aLetter}]`, acceptX + btnW / 2, btnY + btnH / 2);

    // Decline button
    const declineX = cx + 8;
    ctx.fillStyle = '#e94560';
    ctx.fillRect(declineX, btnY, btnW, btnH);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Decline [${dLetter}]`, declineX + btnW / 2, btnY + btnH / 2);

    // Blinking prompt
    if (blink) {
      ctx.fillStyle = '#667788';
      ctx.font = '7px "Pixelify Sans", sans-serif';
      ctx.fillText(`Press ${aLetter} to accept or ${dLetter} to decline`, cx, cardY + cardH - 10);
    }
  }

  private renderInfoOverlay(ctx: CanvasRenderingContext2D): void {
    const pad = 16;
    const w = CANVAS_WIDTH - pad * 2;
    const h = 220;
    const x = pad;
    const y = (CANVAS_HEIGHT - h) / 2;

    ctx.fillStyle = 'rgba(10, 10, 30, 0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#2ecc71';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('CONTROLS', CANVAS_WIDTH / 2, y + 14);

    const lines: [string, string][] = [
      ['Move',        'Arrow keys / WASD'],
      ['Shoot up',    'Z / Space'],
      ['Shoot ←',     'Q'],
      ['Shoot →',     'E'],
      ['Melee stab',  'X  (close range, any time)'],
      ['Git revert',  'C  (clears screen, recovers file)'],
      ['', ''],
      ['Avoid zones', 'Red areas — slows you down'],
      ['Rush zones',  'Green areas — bonus + heal'],
      ['Pickup HP',   'Recovers a lost file'],
    ];

    ctx.font = '7px monospace';
    const col1 = x + 10;
    const col2 = x + 90;
    let ly = y + 30;
    for (const [label, desc] of lines) {
      if (!label) { ly += 4; continue; }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f7dc6f';
      ctx.fillText(label, col1, ly);
      ctx.fillStyle = '#ecf0f1';
      ctx.fillText(desc, col2, ly);
      ly += 12;
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#7f8c8d';
    ctx.font = '6px monospace';
    ctx.fillText('[I] close', CANVAS_WIDTH / 2, y + h - 8);
  }

  private spawnOutlookBoss(): void {
    const x = 40 + Math.random() * (CANVAS_WIDTH - 80);
    this.enemies.push(new OutlookSwarm(x, -20));
    this.outlookBossSpawned = true;
    this.bossName = 'OUTLOOK INVITES';
    this.bossSubtitle = 'Shoot them down!';
    this.bossColor = '#e94560';
    this.bossTitle = 2.5;
    this.shake(0.3, 6);
    playSound('explosion', 0.4);
  }

  private spawnAiBroBoss(): void {
    this.enemies.push(new AiBroStampede(-30));
    this.aiBroSpawned = true;
    this.bossName = 'AI BRO STAMPEDE!';
    this.bossSubtitle = 'HIDE!';
    this.bossColor = '#3498db';
    this.bossTitle = 2.5;
    this.shake(0.5, 8);
    playSound('explosion', 0.5);
  }

  private spawnWave(): void {
    // Track whether an outlook boss is alive
    this.outlookBossActive = this.enemies.some(e => e instanceof OutlookSwarm);

    // Guaranteed boss spawns — OutlookSwarm at 20s, AiBroStampede at 50s
    if (!this.outlookBossSpawned && !this.outlookBossActive && this.gameTime >= 20) {
      this.spawnOutlookBoss();
      return;
    }
    if (!this.aiBroSpawned && !this.enemies.some(e => e instanceof AiBroStampede) && this.gameTime >= 50) {
      this.spawnAiBroBoss();
      return;
    }

    // While outlook boss is active, reduce spawns significantly
    if (this.outlookBossActive && Math.random() < 0.7) return;

    const waveType = Math.random();
    const difficultyScale = Math.min(2, 1 + this.gameTime * 0.01);

    if (waveType < 0.25) {
      // Recruiters from top
      const count = Math.floor(1 + Math.random() * difficultyScale);
      for (let i = 0; i < count; i++) {
        const x = 20 + Math.random() * (CANVAS_WIDTH - 64);
        this.enemies.push(new Recruiter(x, -30 - i * 35));
      }
    } else if (waveType < 0.45) {
      // Interns from top
      const count = Math.floor(1 + Math.random() * 2 * difficultyScale);
      for (let i = 0; i < count; i++) {
        const x = Math.random() * (CANVAS_WIDTH - 24);
        this.enemies.push(new Intern(x, -30 - i * 25));
      }
    } else if (waveType < 0.7) {
      // Side-entry enemies — spawn ON mountain textures
      const fromLeft = Math.random() < 0.5;
      const spans = findBuildingEdgeSpans(this.camera.y, fromLeft ? 'left' : 'right');
      if (spans.length > 0) {
        const span = spans[Math.floor(Math.random() * spans.length)];
        if (span.h >= 32) { // need enough room
          const count = 1 + Math.floor(Math.random() * 2 * difficultyScale);
          for (let i = 0; i < count; i++) {
            const x = fromLeft ? 8 : CANVAS_WIDTH - 24;
            const y = span.y + 8 + Math.random() * (span.h - 32);
            const enemy = new Intern(x, y);
            enemy.vx = fromLeft ? (35 + Math.random() * 20) : -(35 + Math.random() * 20);
            enemy.vy = 8 + Math.random() * 10;
            (enemy as any)._sideSpawn = true; // mark for constraint
            this.enemies.push(enemy);
          }
        }
      }
    } else if (!this.outlookBossActive && waveType > 0.92 && waveType < 0.96) {
      this.spawnOutlookBoss();
    } else if (waveType >= 0.98 && !this.enemies.some(e => e instanceof AiBroStampede)) {
      this.spawnAiBroBoss();
    } else {
      // Recruiters from sides — on mountains
      const fromLeft = Math.random() < 0.5;
      const spans = findBuildingEdgeSpans(this.camera.y, fromLeft ? 'left' : 'right');
      if (spans.length > 0) {
        const span = spans[Math.floor(Math.random() * spans.length)];
        if (span.h >= 32) {
          const x = fromLeft ? 8 : CANVAS_WIDTH - 24;
          const y = span.y + 8 + Math.random() * (span.h - 32);
          const enemy = new Recruiter(x, y);
          enemy.vx = fromLeft ? 30 : -30;
          enemy.vy = 8;
          (enemy as any)._sideSpawn = true;
          this.enemies.push(enemy);
        }
      }
    }
  }

  private fireGitRevert(): void {
    this.player.gitRevertCharges--;
    this.player.invincibleTimer = 1.0;
    this.shake(0.3, 5);
    playSound('revert', 0.4);

    this.enemyBullets = [];

    for (const enemy of this.enemies) {
      enemy.takeDamage(2);
      if (!enemy.active) {
        this.player.score += enemy.scoreValue;
        this.spawnExplosion(enemy.x, enemy.y);
      }
    }
    this.enemies = this.enemies.filter((e) => e.active);
    // Revert recovers a lost file
    this.recoverGitFile();
    this.addPopup('REVERT!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  }

  private shake(duration: number, intensity: number): void {
    this.shakeTimer = duration;
    this.shakeIntensity = intensity;
  }

  private addPopup(text: string, x: number, y: number): void {
    this.popups.push({ text, x, y, timer: 0.8 });
  }

  private spawnExplosion(x: number, y: number): void {
    this.particles.push(new Particle(x, y));
  }

  private maybeDropPickup(x: number, y: number): void {
    if (Math.random() < 0.5) {
      const roll = Math.random();
      if (roll < 0.45) {
        // Weapon drop — weighted by game time
        const weapons: WeaponType[] = this.gameTime < 15
          ? ['smg']
          : this.gameTime < 35
            ? ['smg', 'machinegun']
            : ['smg', 'machinegun', 'shotgun'];
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        this.pickups.push(new Pickup(x, y, 'weapon', weapon));
      } else if (roll < 0.65) {
        // Ammo for current weapon
        this.pickups.push(new Pickup(x, y, 'ammo'));
      } else if (roll < 0.80) {
        this.pickups.push(new Pickup(x, y, 'health'));
      } else if (roll < 0.93) {
        this.pickups.push(new Pickup(x, y, 'revert'));
      } else {
        this.pickups.push(new Pickup(x, y, 'stash'));
      }
    }
  }

  private applyPickup(pickup: Pickup): void {
    const px = this.player.x + this.player.width / 2;
    const py = this.player.y;
    switch (pickup.type) {
      case 'weapon': {
        const wt = pickup.weaponType!;
        const def = WEAPONS[wt];
        this.player.weapon = wt;
        this.player.ammo = def.ammoOnPickup;
        this.addPopup(def.name, px, py);
        break;
      }
      case 'health':
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        this.recoverGitFile();
        this.addPopup('HP+1', px, py);
        break;
      case 'revert':
        this.player.gitRevertCharges = Math.min(5, this.player.gitRevertCharges + 1);
        this.addPopup('REVERT+1', px, py);
        break;
      case 'stash':
        this.player.invincibleTimer = 3;
        this.addPopup('GIT STASH!', px, py);
        break;
      case 'ammo': {
        // Pistol has infinite ammo — an ammo pickup would be wasted, so convert to score.
        if (this.player.weapon === 'pistol') {
          this.player.score += 25;
          this.addPopup('+25', px, py);
          break;
        }
        const ammoDef = WEAPONS[this.player.weapon];
        this.player.ammo = Math.min(ammoDef.ammoOnPickup * 2, this.player.ammo + Math.ceil(ammoDef.ammoOnPickup / 2));
        this.addPopup(`AMMO+${Math.ceil(ammoDef.ammoOnPickup / 2)}`, px, py);
        break;
      }
      case 'cherry-pick': {
        let strongest: Enemy | null = null;
        let maxHp = 0;
        for (const e of this.enemies) {
          if (e.hp > maxHp) { maxHp = e.hp; strongest = e; }
        }
        if (strongest) {
          strongest.takeDamage(999);
          this.spawnExplosion(strongest.x, strongest.y);
          this.player.score += strongest.scoreValue * 2;
        }
        this.recoverGitFile();
        this.addPopup('CHERRY-PICK!', px, py);
        break;
      }
    }
  }

  // --- Git integration helpers ---

  /** Kill the last currently-alive file (mirrors recoverGitFile). Called on each hit that lands. */
  private loseGitFile(): void {
    if (!this.gitContext) return;
    for (let i = this.gitFiles.length - 1; i >= 0; i--) {
      if (this.gitFiles[i].alive) {
        this.gitFiles[i].alive = false;
        this.addPopup(`LOST: ${this.gitFiles[i].name.split('/').pop()}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
        return;
      }
    }
  }

  /** Recover the most recently lost file (used by revert and cherry-pick pickups). */
  private recoverGitFile(): void {
    if (!this.gitContext) return;
    // Find last dead file and revive it
    for (let i = this.gitFiles.length - 1; i >= 0; i--) {
      if (!this.gitFiles[i].alive) {
        this.gitFiles[i].alive = true;
        this.addPopup(`RECOVERED: ${this.gitFiles[i].name.split('/').pop()}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
        return;
      }
    }
  }

  /** Send game result to CLI via WebSocket */
  private sendGitResult(outcome: 'win' | 'loss'): void {
    if (!this.gitContext || this.resultSent) return;
    this.resultSent = true;
    const surviving = this.gitFiles.filter((f) => f.alive).map((f) => f.name);
    const lost = this.gitFiles.filter((f) => !f.alive).map((f) => f.name);
    this.gitContext.sendResult(outcome, surviving, lost);
  }

  private renderLevelIntro(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(15, 15, 35, 0.95)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const cx = CANVAS_WIDTH / 2;

    // Logo — enable smoothing so the hi-res PNG scales cleanly (global flag is off for sprites)
    const logoW = 180;
    const logoH = Math.round(logoW * 820 / 1228);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logoImg, 154, 102, 1228, 820, (CANVAS_WIDTH - logoW) / 2, 6, logoW, logoH);
    ctx.imageSmoothingEnabled = false;

    let y = logoH + 16;

    ctx.fillStyle = '#2ecc71';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('$ git commit', cx, y); y += 18;

    if (this.gitContext) {
      const msg = this.gitContext.payload.commitMessage;
      ctx.fillStyle = '#f7dc6f';
      ctx.font = '8px monospace';
      ctx.fillText(`-m "${msg}"`, cx, y); y += 16;

      ctx.fillStyle = '#ecf0f1';
      ctx.font = '7px monospace';
      ctx.fillText(`${this.gitFiles.length} file(s) staged = ${this.player.maxHp} HP`, cx, y); y += 14;

      const maxShow = Math.min(this.gitFiles.length, 6);
      for (let i = 0; i < maxShow; i++) {
        ctx.fillStyle = '#2ecc71';
        ctx.fillText(`+ ${this.gitFiles[i].name}`, cx, y); y += 11;
      }
      if (this.gitFiles.length > maxShow) {
        ctx.fillStyle = '#7f8c8d';
        ctx.fillText(`... and ${this.gitFiles.length - maxShow} more`, cx, y); y += 11;
      }

      y += 6;
      const linesAdded = this.gitContext.payload.linesAdded;
      const estSeconds = Math.round((this.gameRows - 21) * 16 / 18);
      const estMin = Math.floor(estSeconds / 60);
      const estSec = estSeconds % 60;
      const estLabel = estMin > 0 ? `~${estMin}m ${estSec}s` : `~${estSec}s`;
      ctx.fillStyle = '#bdc3c7';
      ctx.font = '7px monospace';
      ctx.fillText(`${linesAdded} lines + ${this.gitFiles.length} files \u2192 ${estLabel}`, cx, y); y += 13;

      const diffLabel = this.gitContext.difficulty === 'extreme' ? 'EXTREME \u2014 files DELETED on death!' : 'BASIC \u2014 files unstaged on death';
      ctx.fillStyle = this.gitContext.difficulty === 'extreme' ? '#e94560' : '#3498db';
      ctx.fillText(diffLabel, cx, y);
    }

    if (Math.floor(Date.now() / 500) % 2 === 0) {
      ctx.fillStyle = '#f5a623';
      ctx.font = '8px monospace';
      ctx.fillText('Press any key to start', cx, CANVAS_HEIGHT - 30);
    }
    ctx.fillStyle = '#7f8c8d';
    ctx.font = '6px monospace';
    ctx.fillText('[I] controls', cx, CANVAS_HEIGHT - 14);
  }

  private renderGitWin(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(5, 20, 10, 0.95)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const cx = CANVAS_WIDTH / 2;

    ctx.fillStyle = '#2ecc71';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('COMMIT SUCCESSFUL', cx, 60);

    ctx.fillStyle = '#f7dc6f';
    ctx.font = '8px monospace';
    ctx.fillText(`"${this.gitContext!.payload.commitMessage}"`, cx, 85);

    drawSoldier(ctx, soldierGunImg, cx, 100, -Math.PI / 2);

    // File results
    let y = 140;
    ctx.font = '7px monospace';
    for (const f of this.gitFiles) {
      if (f.alive) {
        ctx.fillStyle = '#2ecc71';
        ctx.fillText(`\u2713 ${f.name}`, cx, y);
      } else {
        ctx.fillStyle = '#e94560';
        ctx.fillText(`\u2717 ${f.name}`, cx, y);
      }
      y += 12;
    }

    const surviving = this.gitFiles.filter((f) => f.alive).length;
    const lost = this.gitFiles.filter((f) => !f.alive).length;

    y += 10;
    ctx.fillStyle = '#ecf0f1';
    ctx.font = '8px monospace';
    ctx.fillText(`${surviving} committed, ${lost} lost`, cx, y);

    y += 15;
    ctx.fillStyle = '#f7dc6f';
    ctx.font = '10px monospace';
    ctx.fillText(`Score: ${this.player.score}`, cx, y);

    ctx.fillStyle = '#7f8c8d';
    ctx.font = '6px monospace';
    ctx.fillText('You can close this tab', cx, CANVAS_HEIGHT - 20);
  }

  private renderGitGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(15, 15, 35, 0.95)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const cx = CANVAS_WIDTH / 2;

    ctx.fillStyle = '#e94560';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('COMMIT FAILED', cx, 60);

    // Dead character lying down
    drawSoldier(ctx, soldierGunImg, cx, 90, 0);

    const isExtreme = this.gitContext!.difficulty === 'extreme';

    // File results
    let y = 130;
    ctx.font = '7px monospace';
    for (const f of this.gitFiles) {
      ctx.fillStyle = '#e94560';
      const action = isExtreme ? 'DELETED' : 'unstaged';
      ctx.fillText(`\u2717 ${f.name} — ${action}`, cx, y);
      y += 12;
    }

    y += 10;
    ctx.fillStyle = '#7f8c8d';
    ctx.font = '6px monospace';
    ctx.fillText(isExtreme ? '$ rm -f <files> && git reset HEAD' : '$ git reset HEAD -- <files>', cx, y);

    y += 20;
    ctx.fillStyle = '#f7dc6f';
    ctx.font = '10px monospace';
    ctx.fillText(`Score: ${this.player.score}`, cx, y);

    ctx.fillStyle = '#7f8c8d';
    ctx.font = '6px monospace';
    ctx.fillText('You can close this tab', cx, CANVAS_HEIGHT - 20);
  }

  private reset(): void {
    this.player = new Player();
    this.activeMountain = null;
    this.playerBullets = [];
    this.enemyBullets = [];
    this.enemies = [];
    this.pickups = [];
    this.particles = [];
    this.camera = new Camera();
    this.spawnTimer = 1;
    this.outlookBossActive = false;
    this.popups = [];
    this.outlookInvites = [];
    this.meetingModal = null;
    this.gameTime = 0;
    this.rushHealTimer = 0;
    this.announcements = new AnnouncementSystem();
    this.outlookBossSpawned = false;
    this.aiBroSpawned = false;

    // Restore git HP if in git mode
    if (this.gitContext) {
      for (const f of this.gitFiles) f.alive = true;
      this.setupGitHp();
      this.resultSent = false;
    }
  }
}
