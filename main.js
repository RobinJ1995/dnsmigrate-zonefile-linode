let Fs = require ('fs');
let Promise = require ('bluebird');
let DnsZonefile = require ('dns-zonefile');
let Linode = require ('linode-api-node');
let Config = require ('./config.json');

let lnc = new Linode (Config.linode_api_key);
lnc.requestDelay = 1000;

let chain = lnc.getDomains ()
.then ((response) => {
	let domainsToRemove = response.domains;
	let chain2 = Promise.resolve (true);
	
	if (Config.remove_existing)
	{
		for (let domain of domainsToRemove)
		{
			chain2 = chain2.then (() => {
				console.log ('Removing domain ' + domain.domain);
	
				return lnc.removeDomain (domain.id);
			});
		}
	}
	
	return chain2;
});

let zones = Fs.readdirSync (Config.zone_dir);
for (let zoneFile of zones)
{
	let zoneTxt = String (Fs.readFileSync (Config.zone_dir + zoneFile));
	let zone = DnsZonefile.parse (zoneTxt);
	
	let domain = zone.ns[0].name;
	domain = domain.substr (0, domain.length - 1);
	
	chain = chain.then (() => {
		return lnc.getDomains ();
	})
	.then ((response) => {
		let domains = response.domains.map ((d) => { return d.domain });
		
		if (domains.includes (domain))
			return response.domains.filter ((d) => { return d.domain === domain })[0];
		
		console.log ('Creating domain ' + domain);
		
		return lnc.createDomain ({ domain: domain, soa_email: Config.soa_email, type: 'master' })
	})
	.then ((response) => {
		let domainId = response.id;
		let subchain = Promise.resolve (true);
		
		for (let type in zone)
		{
			if (['soa', 'ns'].includes (type) || type.startsWith ('$'))
				continue;
			
			for (let entry of zone[type])
			{
				let target = entry.ip || entry.host || entry.alias || entry.txt;
				let record = {
					type: type.toUpperCase (),
					name: stripTrailing (entry.name, domain),
					target: type.toUpperCase () === 'TXT' ? stripTXTQuotes (target) : stripTrailing (target),
					priority: entry.preference + 1
				};
				
				subchain = subchain.then (() => {
					return lnc.getDomainRecords (domainId).then ((response) => {
						if (response.records)
						{
							let filtered = response.records.filter ((r) => { return r.type == record.type && r.target == record.target && r.name == record.name });
						
							if (filtered.length > 0)
								return filtered[0];
						}
					
						console.log ('Creating ' + record.type + ' record for ' + domain);
					
						return lnc.createDomainRecord (domainId, record);
					})
					.catch ((err) => {
						console.error (domain, err.message, record);
					});
				});
			}
		}
		
		return subchain;
	})
	.catch ((err) => {
		console.error (domain, err.message);
	});
}

function stripTrailing (str, domain)
{
	if (str.endsWith ('.'))
		str = str.slice (0, -1);
	if (str.endsWith (domain))
		str = str.slice (0, -(domain.length));
	if (str.endsWith ('.'))
		str = str.slice (0, -1);
	
	return str;
}

function stripTXTQuotes (str)
{
	if (str.startsWith ('"') && str.endsWith ('"'))
		return str.slice (1, -1);
	
	return str;
}
