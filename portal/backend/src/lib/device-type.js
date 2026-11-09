// Which Devices-tab type something is: workstation, server, firewall, switch, printer,
// nas, network (routers, access points, controllers…) or other (TVs, phones, cameras,
// UPSes, out-of-band cards — things on the network that aren't network gear).
// Pure functions only, unit-tested.
//
// Evidence, strongest first:
//   1. the outside system's own category — ConnectWise RMM's resourceType (PRINTER,
//      SWITCH, LAYER_3_SWITCH, FIREWALL, NETWORK_STORAGE, AUDIO/VISUAL, …). Discovered
//      network gear all arrives with endpointType "NetworkDevice", so that alone says
//      nothing about what the device is.
//   2. the kind named in the endpoint type itself ("Network Switch", "Printer")
//   3. a machine with an RMM agent / operating system is a workstation or server (or a
//      NAS that runs an OS, like a Buffalo TeraStation)
//   4. the make, model and name: a catalog of the printer, switch, firewall, NAS, … lines
//      techs actually run into, plus the hostnames printers give themselves (BRN…, NPI…)
//   5. anything else discovered on the network is "network"

const norm = (v) => String(v ?? '').trim().toLowerCase();

// ConnectWise resourceType → type. Normalised to lower_snake first ("AUDIO/VISUAL" → audio_visual).
// Order matters: network_storage must hit nas before anything matches "network".
const CATEGORY = [
  [/^(printer|mfp|multi_?function|copier|plotter|label_printer|print_server)/, 'printer'],
  [/switch/, 'switch'],
  [/firewall|utm|security_appliance/, 'firewall'],
  [/storage|\bnas\b|^san$/, 'nas'],
  [/audio|visual|multimedia|tablet|phone|voip|camera|nvr|dvr|\bups\b|power|intelligent_platform|ipmi|out_of_band|kvm|iot|television|\btv\b|media|game|smart_home/, 'other'],
  [/router|gateway|wireless|access_point|wlan|controller|modem|bridge|network/, 'network'],
  [/^server$|virtual_machine|hypervisor/, 'server'],
  [/desktop|laptop|workstation|notebook|thin_client/, 'workstation'],
];

export function categoryType(category) {
  const c = norm(category).replace(/[^a-z0-9]+/g, '_');
  if (!c) return null;
  for (const [re, type] of CATEGORY) if (re.test(c)) return type;
  return null;
}

// ─── Brand / model catalog ────────────────────────────────────────────────────
// Tested against `${manufacturer} ${model} ${name}`, lower-cased. Kept specific: a word
// like "Dell" or "HP" alone never decides, the product line does.

const FIREWALL = [
  /\bsonicwall\b(?!.*sonicwave)/, /\b(tz\s?\d{2,3}[a-z]?|nsa\s?\d{3,4}|nsv\s?\d{2,3}|supermassive|soho\s?\d{3})\b.*\bsonicwall\b/,
  /\b(fortigate|fortiwifi|fg-?\d{2,4}[a-z]?|fwf-?\d{2,3})\b/,
  /\bmeraki\b.*\bmx\s?\d{2,3}|\bmx\d{2,3}[a-z]?\b.*\bmeraki\b/,
  /\b(asa\s?55\d{2}|asa\s?\d{4}-?x?|firepower|fpr-?\d{3,4})\b/,
  /\bpalo\s?alto\b|\bpa-\d{3,4}\b/,
  /\b(watchguard|firebox)\b/,
  /\bsophos\b.*\b(xgs?|sg|utm)\s?\d{2,4}\b|\bsophos\s?(firewall|utm)\b/,
  /\b(pfsense|opnsense|netgate)\b/,
  /\b(udm(-?pro|-?se)?|usg(-?pro)?|ucg|uxg|udr\d?|dream\s?(machine|router|wall)|cloud\s?gateway)\b/,
  /\b(cyberoam|barracuda\s?(cloudgen|nextgen|ng\s?firewall)|check\s?point|untangle|zywall|usg\s?flex|zyxel\s?atp\d{3}|srx\d{3,4})\b/,
  /\bfirewall\b/,
];

const SWITCH = [
  /\b(switch|smart\s?switch|smartswitch|switching)\b/,
  /\b(procurve|officeconnect|catalyst|nexus|edgeswitch|jetstream|powerconnect|prosafe|fortiswitch|instant\s?on\s?1[89]\d{2})\b/,
  /\b(hp|hpe|aruba)\b.*\b(1[0-9]{3}|2[0-9]{3}|3[0-9]{3}|5[0-9]{3}|6[0-9]{3}|8[0-9]{3})[a-z]?\b.*\b(\d{1,2}g|\d{1,2}-?port)\b/,
  /\b(hp|hpe|aruba)\b.*\b(1820|1920s?|1930|1950|1960|2530|2540|2610|2620|2915|2920|2930[fm]?|3800|3810m?|5400r?|6000|6100|6200f?|6300[fm]?|6400|8320|cx\s?\d{4})\b/,
  /\b(j\d{4}a|jl\d{3}a|jg\d{3}a)\b/,                                     // HP / Aruba switch part numbers (J9773A, JL686B)
  /\b(ws-c\d{4}|c9[2-6]\d{2}[a-z]*|c1000-|cbs\d{3}|sg\d{3}x?-|sg\d{3}x?\b|sx\d{3}|meraki\s?ms\d{2,3}|ms\d{3}-\d)/,
  /\b(usw(-|\s|\b)|us-\d{1,2}|unifi\s?switch|es-\d{2})/,
  /\b(netgear\b.*\b(gs\d{3,4}|gsm\d{4}|fs\d{3}|xs\d{3}|m4\d{3}|jgs\d{3}))|\b(gs\d{3,4}[a-z]{0,4}|gsm\d{4}[a-z]*|fs7\d{2}[a-z]*)\b/,
  /\b(tl-sg\d+|sg\d{4}[a-z]*|t\d{4}g?-\d+|tl-sl\d+)\b/,                  // TP-Link
  /\b(dgs-\d{4}|des-\d{4})\b/,                                           // D-Link
  /\bdell\b.*\b(n\d{4}[a-z]*|s\d{4}-on|x\d{4}[a-z]?|powerconnect)\b/,
  /\b(icx\s?\d{4}|ex\d{4}|x\d{3}-\d{2}|crs\d{3}|css\d{3}|lgs\d{3}|eds-\d|gs-\d{4}|xgs\d{4}|gs19\d{2}|at-x\d{3}|s5700|s6720)\b/,
];

const PRINTER = [
  /\b(laserjet|officejet|deskjet|designjet|pagewide|photosmart|neverstop|smart\s?tank|envy\s?(photo\s?)?\d{4})\b/,       // HP
  /\b(imagerunner|imageclass|imagepress|pixma|maxify|i-sensys|selphy)\b|\bcanon\b.*\b(d\d{3,4}|mf\d{3,4}|lbp\d{3,4}|ir-?adv|ir\d{4}|tr\d{4}|ts\d{4}|g\d{4})\b/,
  /\bbrother\b.*\b(nc-?\d|hl-|mfc-|dcp-|ql-|pt-|td-|ads-|printer)/,
  /\bepson\b.*\b(wf-|wp-|et-|xp-|l\d{3,4}|tm-|workforce|ecotank|expression|surecolor|stylus|printer)/,
  /\bricoh\b.*\b(im\s?c?\d{3,4}|mp\s?c?\d{3,4}|sp\s?c?\d{3,4}|p\s?c?\d{3,4}|aficio|printer)/,
  /\bkyocera\b|\b(ecosys|taskalfa)\b/,
  /\bsharp\b.*\b(mx-|bp-|ar-|printer|copier)/,
  /\b(xerox|versalink|altalink|workcentre|phaser|primelink|docucentre)\b/,
  /\b(konica|minolta|bizhub|lexmark|okidata|pantum|dymo)\b|\boki\s?(c|b|mc|mb)\d{3}/,
  /\bzebra\b.*\b(z[tdq]\d{3}|g[kx]\d{3}|zm\d{3}|\d{3}xi|printer|label)/,
  /\b(e-?studio)\b/,
  /\bsamsung\b.*\b(xpress|proxpress|clx-|clp-|ml-\d|scx-|m\d{4}f?w?)\b/,
  /\bdell\s+([bcs]\d{4}[a-z]{0,4}|e\d{3}[a-z]{1,3})\b/,                   // Dell B2360dn, C1760nw, E514dw
  /\b(printer|mfp|copier|plotter|multifunction|printing\s?system|print\s?server|label\s?printer)\b/,
];

// Hostnames printers give themselves (usually a prefix + the end of the MAC address).
const PRINTER_NAME = [
  /^br[nw][0-9a-f]{8,}$/,          // Brother: BRN3C2AF4D088B9
  /^npi[0-9a-f]{6}$/,              // HP JetDirect: NPI23FFFF
  /^hpi?[0-9a-f]{6}$/,             // HP: HP00AA11, HPI0A1B2C
  /^epson[0-9a-f]{6}$/,            // Epson: EPSON490DCC
  /^km[0-9a-f]{6}(\.local\.?)?$/,  // Kyocera: KM388E5A.local.
  /^rnp[0-9a-f]{6,}$/,             // Ricoh
  /^xrx[0-9a-f]{12}$/,             // Xerox
  /^sec[0-9a-f]{12}$/,             // Samsung
  /^et[0-9a-f]{12}$/,              // Dell / Lexmark: ET0021B709FA20
  /^kmbt/, /^lxk/,
];

const NAS = [
  /\b(synology|diskstation|rackstation|qnap|terastation|linkstation|readynas|asustor|terramaster|drobo|unas(\s?pro)?)\b/,
  /\b(ds|rs)\d{3,4}(\+|xs\+?|play|j)?\b.*\b(synology|diskstation)\b|\b(synology|diskstation)\b.*\b(ds|rs)\d{3,4}/,
  /\b(ts|tvs|tes|tbs)-\d{3,4}/,                                          // QNAP
  /\bmy\s?cloud\s?(ex|pr|home)?\d*\b/,
  /\bnas\b/,
];

const OTHER = [
  /\b(television|smart\s?tv|\btv\b|bravia|qled|oled|roku|chromecast|apple\s?tv|fire\s?tv|shield\s?tv|sonos|echo\s?(dot|show)?|alexa|xbox|playstation|nintendo)\b/,
  /\b(ipad|iphone|galaxy\s?(tab|s\d+)|tablet|android|pixel\s?\d)\b/,
  /\b(polycom|yealink|grandstream\s?(gxp|grp|wp)|cisco\s?ip\s?phone|mitel|avaya|snom|fanvil|obihai|vvx\s?\d+|cp-\d{4}|ip\s?phone)\b/,
  /\b(hikvision|dahua|axis|avigilon|exacq|lorex|amcrest|reolink|hanwha|wisenet|uniview|vivotek|nvr|dvr|ip\s?camera|ds-\d{4}[a-z]{0,3}-)/,
  /\b(ups|smart-ups|back-ups|symmetra|network\s?management\s?card|eaton|cyberpower|tripp\s?lite|pdu|vertiv|liebert)\b|\bapc\b/,
  /\b(idrac|ilo\s?\d?|ipmi|xclarity|bmc)\b/,
  /\b(ecobee|nest|thermostat|ring\s?doorbell|hue\s?bridge|raspberry\s?pi)\b/,
];

const NETWORK = [
  /\b(access\s?point|unifi\s?ap|uap|u6|u7|aironet|meraki\s?mr\d+|ruckus\s?r\d{3}|sonicwave|engenius|eap\d{3}|ap-\d{3})\b/,
  /\b(router|edgerouter|mikrotik|cloud\s?key|wlan\s?controller|wireless|orbi|nighthawk|airport|modem|gateway|cradlepoint|peplink|draytek|vigor\d+|access\s?bridge|nanostation|litebeam|airmax)\b/,
];

const any = (list, text) => list.some(re => re.test(text));

/** The type the make / model / name points to, or null when nothing recognisable. */
export function brandType({ manufacturer, model, name } = {}) {
  const text = norm(`${manufacturer ?? ''} ${model ?? ''} ${name ?? ''}`).replace(/\s+/g, ' ');
  const names = String(name ?? '').split(/\s+/).map(norm).filter(Boolean);
  if (!text.trim()) return null;
  if (any(OTHER, text)) return 'other';            // cameras / TVs first: "Hikvision … switch" ports, "Samsung TV"
  if (any(FIREWALL, text)) return 'firewall';
  if (any(PRINTER, text) || names.some(n => any(PRINTER_NAME, n))) return 'printer';
  if (any(NAS, text)) return 'nas';
  if (any(SWITCH, text)) return 'switch';
  if (any(NETWORK, text)) return 'network';
  return null;
}

/**
 * The Devices-tab type for a device from an outside system.
 * @param d { category, hint, os, manufacturer, model, name }
 *   category — the system's own classification (ConnectWise resourceType)
 *   hint     — its endpoint type ("Desktop", "Server", "NetworkDevice", "Laptop"…)
 *   os       — the operating system, if it reports one (only agents do)
 */
export function classifyDevice(d = {}) {
  const fromCategory = categoryType(d.category);
  const hint = `${norm(d.hint)} ${norm(d.os)}`;
  const brand = brandType(d);

  // 1. The system classified network gear itself — trust it.
  if (fromCategory && fromCategory !== 'server' && fromCategory !== 'workstation' && fromCategory !== 'network') return fromCategory;

  // 2. Older / other shapes name the kind in the endpoint type itself ("Network Switch",
  //    "Printer"); "Windows Storage Server" is a NAS box (a Buffalo TeraStation).
  if (/firewall|utm/.test(hint)) return 'firewall';
  if (/switch/.test(hint)) return 'switch';
  if (/printer/.test(hint)) return 'printer';
  if (/\bnas\b|storage/.test(hint)) return 'nas';

  // 3. A machine with an agent / OS is a computer — unless it's a NAS that runs an OS.
  const os = norm(d.os);
  const computer = fromCategory === 'server' || fromCategory === 'workstation'
    || /desktop|laptop|notebook|workstation|server/.test(norm(d.hint)) || (os && os !== 'unknown');
  if (computer && !/network\s?device/.test(norm(d.hint))) {
    if (brand === 'nas') return 'nas';
    return fromCategory === 'server' || /server/.test(hint) ? 'server' : 'workstation';
  }

  // 4. What the make / model / name says.
  if (brand) return brand;

  // 5. Anything else found on the network is network gear; a bare record is a workstation.
  if (fromCategory === 'network' || /router|access ?point|\bap\b|wireless|network/.test(hint)) return 'network';
  return 'workstation';
}

export const TYPE_LABEL = {
  workstation: 'Workstation', server: 'Server', firewall: 'Firewall', switch: 'Switch',
  printer: 'Printer', nas: 'NAS', network: 'Network', other: 'Other',
};
