export type WeaponType = 'pistol' | 'smg' | 'machinegun' | 'shotgun';

export interface WeaponDef {
  name: string;
  fireRate: number;
  bulletSpeed: number;
  damage: number;
  spread: number;       // bullets per shot
  spreadAngle: number;  // total cone in radians
  ammoOnPickup: number;
}

export const WEAPONS: Record<WeaponType, WeaponDef> = {
  pistol: {
    name: 'PISTOL',
    fireRate: 0.15,
    bulletSpeed: 200,
    damage: 1,
    spread: 1,
    spreadAngle: 0,
    ammoOnPickup: 15,
  },
  smg: {
    name: 'SMG',
    fireRate: 0.08,
    bulletSpeed: 230,
    damage: 1,
    spread: 1,
    spreadAngle: 0.12,
    ammoOnPickup: 40,
  },
  machinegun: {
    name: 'MACHINE GUN',
    fireRate: 0.05,
    bulletSpeed: 190,
    damage: 1,
    spread: 3,
    spreadAngle: 0.5,
    ammoOnPickup: 120,
  },
  shotgun: {
    name: 'SHOTGUN',
    fireRate: 0.45,
    bulletSpeed: 180,
    damage: 2,
    spread: 5,
    spreadAngle: 0.6,
    ammoOnPickup: 12,
  },
};

export const WEAPON_LIST: WeaponType[] = ['pistol', 'smg', 'machinegun', 'shotgun'];
