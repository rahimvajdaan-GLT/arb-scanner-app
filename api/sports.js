// These values must match the engine's internal sport names, not unsupported league aliases.
// A label is intentionally broad where source data doesn't preserve a league identifier.
const SPORTS = [
  {key:'nfl',title:'American Football (NFL / NCAAF)',group:'American Football'},
  {key:'basketball',title:'Basketball (NBA / NBL)',group:'Basketball'},
  {key:'baseball',title:'Baseball (MLB)',group:'Baseball'},
  {key:'nhl',title:'Ice Hockey (NHL)',group:'Ice Hockey'},
  {key:'soccer',title:'Soccer — available leagues',group:'Soccer'},
  {key:'tennis',title:'Tennis (ATP / WTA)',group:'Tennis'},
  {key:'afl',title:'Australian Rules (AFL)',group:'Australian Rules'},
  {key:'nrl',title:'Rugby League (NRL / RLWC)',group:'Rugby League'},
  {key:'cricket',title:'Cricket',group:'Cricket'},
];
export default async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'})}
 res.setHeader('Cache-Control','public, s-maxage=300');
 return res.status(200).json(SPORTS);
}
