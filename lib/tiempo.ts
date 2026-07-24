const TZ = "Europe/Madrid";

export function hoyMadrid(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
}

export function diaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}

export function madridAUtc(fecha: string, hora: string): Date {
  const guess = new Date(`${fecha}T${hora}:00Z`);
  const wall = new Date(guess.toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T") + "Z");
  return new Date(guess.getTime() - (wall.getTime() - guess.getTime()));
}

export function horaMadrid(d: Date): string {
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function fechaMadrid(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d);
}

export function sumarMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
