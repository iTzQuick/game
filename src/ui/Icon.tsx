// Icone dipinte (Higgsfield) dell'interfaccia: public/ui/icone/<nome>.webp.
// Nomi: <classe>-<Q|E|R|F>, classe-<classe>, slot-<arma|armatura|amuleto>,
// frammenti, pozione, attacco, schivata, forgia, giardino, biblioteca, trofei, osservatorio,
// ossigeno, verita, voto, campana (Città Sommersa).

export const iconUrl = (name: string) => `${import.meta.env.BASE_URL}ui/icone/${name}.webp`;

export function Icon({ name, size = 24, className = '' }: { name: string; size?: number; className?: string }) {
  return <img className={`icon-img ${className}`} src={iconUrl(name)} width={size} height={size} alt="" draggable={false} aria-hidden />;
}
