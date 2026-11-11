// Diagram of which services can talk to which: the Portal's three containers on the
// left, the Field App's on the right. Two-headed arrows are request-and-reply within an
// app; the bridge from the Portal API to the Field API is one-way (the Field App can
// never open a connection to the Portal). Dashed red lines mark paths that do not exist.

const BOX_W = 170;
const BOX_H = 52;
const LEFT = 30;
const RIGHT = 440;
const ROWS = [70, 190, 310];

function Box({ x, y, name, detail, tone }) {
  return (
    <g>
      <rect x={x} y={y} width={BOX_W} height={BOX_H} rx="10"
        className={`fill-surface-700 ${tone === 'portal' ? 'stroke-brand' : 'stroke-accent'}`} strokeWidth="2" />
      <text x={x + BOX_W / 2} y={y + 23} textAnchor="middle" className="fill-gray-100 font-mono" fontSize="15" fontWeight="600">{name}</text>
      <text x={x + BOX_W / 2} y={y + 41} textAnchor="middle" className="fill-gray-400" fontSize="11">{detail}</text>
    </g>
  );
}

const cx = (x) => x + BOX_W / 2;

export function ServiceMap() {
  const [web, api, db] = ROWS;
  return (
    <figure className="space-y-2">
      <svg viewBox="0 0 640 400" className="w-full max-w-2xl mx-auto" role="img"
        aria-label="Portal web, API and database on the left; Field web, API and database on the right. Each web talks to its API, each API to its database. The Portal API can call the Field API one way. Nothing else is connected.">
        <defs>
          <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-gray-300" />
          </marker>
          <marker id="sm-arrow-bridge" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className="fill-accent" />
          </marker>
        </defs>

        {/* Column headings and entrances */}
        <text x={cx(LEFT)} y="22" textAnchor="middle" className="fill-gray-200" fontSize="14" fontWeight="600">Portal</text>
        <text x={cx(LEFT)} y="42" textAnchor="middle" className="fill-gray-500" fontSize="11">office network only ↓</text>
        <text x={cx(RIGHT)} y="22" textAnchor="middle" className="fill-gray-200" fontSize="14" fontWeight="600">Field App</text>
        <text x={cx(RIGHT)} y="42" textAnchor="middle" className="fill-gray-500" fontSize="11">internet (via proxy) and office ↓</text>

        {/* Within each app: request and reply */}
        {[LEFT, RIGHT].map(x => (
          <g key={x} className="stroke-gray-300" strokeWidth="2">
            <line x1={cx(x)} y1={web + BOX_H + 4} x2={cx(x)} y2={api - 6} markerStart="url(#sm-arrow)" markerEnd="url(#sm-arrow)" />
            <line x1={cx(x)} y1={api + BOX_H + 4} x2={cx(x)} y2={db - 6} markerStart="url(#sm-arrow)" markerEnd="url(#sm-arrow)" />
          </g>
        ))}

        {/* The one-way bridge */}
        <line x1={LEFT + BOX_W + 4} y1={api + BOX_H / 2} x2={RIGHT - 8} y2={api + BOX_H / 2}
          className="stroke-accent" strokeWidth="3" markerEnd="url(#sm-arrow-bridge)" />
        <text x="320" y={api + BOX_H / 2 - 10} textAnchor="middle" className="fill-accent" fontSize="12" fontWeight="600">one-way</text>
        <text x="320" y={api + BOX_H / 2 + 20} textAnchor="middle" className="fill-gray-400" fontSize="11">service calls only</text>

        {/* Paths that do not exist */}
        {[web, db].map(y => (
          <g key={y}>
            <line x1={LEFT + BOX_W + 10} y1={y + BOX_H / 2} x2={RIGHT - 10} y2={y + BOX_H / 2}
              className="stroke-red-500/70" strokeWidth="1.5" strokeDasharray="5 6" />
            <circle cx="320" cy={y + BOX_H / 2} r="11" className="fill-surface-800 stroke-red-500/70" strokeWidth="1.5" />
            <path d={`M314,${y + BOX_H / 2 - 6} l12,12 M326,${y + BOX_H / 2 - 6} l-12,12`} className="stroke-red-400" strokeWidth="2" />
          </g>
        ))}

        <Box x={LEFT} y={web} name="portal-web" detail="web page (HTTPS)" tone="portal" />
        <Box x={LEFT} y={api} name="portal-api" detail="application" tone="portal" />
        <Box x={LEFT} y={db} name="portal-db" detail="database" tone="portal" />
        <Box x={RIGHT} y={web} name="field-web" detail="web page (HTTPS)" tone="field" />
        <Box x={RIGHT} y={api} name="field-api" detail="application" tone="field" />
        <Box x={RIGHT} y={db} name="field-db" detail="database" tone="field" />

        <text x="320" y="392" textAnchor="middle" className="fill-gray-500" fontSize="11">Databases have no internet access. Dashed red lines: no connection possible.</text>
      </svg>
    </figure>
  );
}
