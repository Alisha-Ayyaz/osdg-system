import { useState, useEffect, useMemo } from 'react';
import { Settings, Plus, Trash2, Key, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface ApiConfig {
  id: string;
  name: string;
  key: string;
}

const STANDARD_APIS = [
  { id: 'scamadvisor', label: 'ScamAdvisor', envKey: 'SCAMADVISER_API_KEY' },
  { id: 'ipinfo', label: 'IPinfo', envKey: 'IPINFO_API_KEY' },
  { id: 'virustotal', label: 'VirusTotal', envKey: 'VIRUSTOTAL_API_KEY' },
  { id: 'alienvault', label: 'AlienVault OTX', envKey: 'ALIENVAULT_OTX_API_KEY' },
  { id: 'abuseipdb', label: 'AbuseIPDB', envKey: 'ABUSEIPDB_API_KEY' },
  { id: 'peeringdb', label: 'PeeringDB', envKey: 'PEERINGDB_API_KEY' },
  { id: 'maxmind', label: 'MaxMind (GeoIP)', envKey: 'MAXMIND_LICENSE_KEY' },
  { id: 'whoisxml', label: 'WhoisXML API', envKey: 'WHOIS_XML_API_KEY' },
  { id: 'numverify', label: 'NumVerify', envKey: 'NUMVERIFY_API_KEY' },
  { id: 'etherscan', label: 'Etherscan', envKey: 'ETHERSCAN_API_KEY' },
  { id: 'shodan', label: 'Shodan', envKey: 'SHODAN_API_KEY' },
  { id: 'youtube', label: 'YouTube API', envKey: 'YOUTUBE_API_KEY' },
  { id: 'google_search', label: 'Google Search', envKey: 'GOOGLE_SEARCH_API_KEY' },
  { id: 'twitter', label: 'Twitter (X)', envKey: 'TWITTER_API_KEY' },
  { id: 'opensanctions', label: 'OpenSanctions', envKey: 'OPENSANCTIONS_API_KEY' },
  { id: 'mitre', label: 'MITRE ATT&CK', envKey: 'MITRE_API_KEY' },
  { id: 'polyswarm', label: 'PolySwarm', envKey: 'POLYSWARM_API_KEY' },
  { id: 'censys', label: 'Censys', envKey: 'CENSYS_API_ID' },
  { id: 'linkedin', label: 'LinkedIn', envKey: 'LINKEDIN_API_KEY' },
  { id: 'facebook', label: 'Facebook', envKey: 'FACEBOOK_API_KEY' },
];

export const useApiConfigs = () => {
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('osdg_api_configs');
    if (stored) {
      try {
        setApiConfigs(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse api configs from localStorage');
      }
    }
  }, []);

  const saveConfig = (configs: ApiConfig[]) => {
    setApiConfigs(configs);
    localStorage.setItem('osdg_api_configs', JSON.stringify(configs));
  };

  return { apiConfigs, saveConfig };
};

const ApiDashboard = () => {
  const { apiConfigs, saveConfig } = useApiConfigs();
  const [isOpen, setIsOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  
  // Form State
  const [targetName, setTargetName] = useState('');
  const [targetKey, setTargetKey] = useState('');

  // Merge Standard APIs with User-added Custom APIs for the grid
  const displayedApis = useMemo(() => {
    const list = [...STANDARD_APIS.map(api => ({
      ...api,
      isCustom: false
    }))];
    
    // Add custom APIs that aren't in the standard list
    apiConfigs.forEach(config => {
      if (!STANDARD_APIS.some(s => s.envKey === config.name)) {
        list.push({
          id: `custom-${config.id}`,
          label: config.name.replace(/_API_KEY$/i, '').replace(/_/g, ' '),
          envKey: config.name,
          isCustom: true
        });
      }
    });
    
    return list;
  }, [apiConfigs]);

  const getApiStatus = (envKey: string) => {
    return apiConfigs.some(c => c.name === envKey && c.key.trim() !== '');
  };

  const handleSaveApi = () => {
    if (!targetName.trim() || !targetKey.trim()) return;
    
    const name = targetName.trim().toUpperCase(); // Normalize to uppercase env style
    const existingIndex = apiConfigs.findIndex(c => c.name === name);
    let newConfigs = [...apiConfigs];
    
    if (existingIndex >= 0) {
      newConfigs[existingIndex] = { ...newConfigs[existingIndex], key: targetKey.trim() };
    } else {
      newConfigs.push({
        id: Math.random().toString(36).substring(2, 9),
        name: name,
        key: targetKey.trim(),
      });
    }
    
    saveConfig(newConfigs);
    setTargetName('');
    setTargetKey('');
    setShowKey(false);
  };

  const handleDelete = (name: string) => {
    saveConfig(apiConfigs.filter(c => c.name !== name));
  };

  const handleEdit = (name: string, key: string) => {
    setTargetName(name);
    setTargetKey(key);
    setShowKey(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs font-mono gap-1.5 hover:bg-primary/10 hover:text-primary transition-all duration-300"
        >
          <Settings className="h-3 w-3" /> APIs Active
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] bg-card border-border shadow-2xl overflow-hidden flex flex-col h-[600px]">
        <DialogHeader className="pb-4 border-b border-border shrink-0">
          <DialogTitle className="font-mono text-lg text-primary flex items-center gap-3">
            <Key className="w-5 h-5" /> OSDG API Dashboard
          </DialogTitle>
          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-tight mt-1">
            Dynamic Intelligence Provisioning
          </p>
        </DialogHeader>
        
        {/* Scrollable Grid Container */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <ScrollArea className="flex-1 px-1 mt-4">
            <div className="grid grid-cols-3 gap-3 pb-4">
              {displayedApis.map((api) => {
                const isConnected = getApiStatus(api.envKey);
                const config = apiConfigs.find(c => c.name === api.envKey);
                
                return (
                  <Card 
                    key={api.id} 
                    onClick={() => handleEdit(api.envKey, config?.key || '')}
                    className={`p-3 border transition-all duration-200 cursor-pointer hover:scale-[1.02] active:scale-95 group relative ${
                      isConnected 
                        ? 'bg-primary/5 border-primary/20 shadow-sm' 
                        : 'bg-secondary/20 border-border opacity-70 hover:opacity-100'
                    }`}
                  >
                    {api.isCustom && isConnected && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(api.envKey); }}
                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                    <div className="space-y-2">
                      <h3 className="text-[10px] font-bold font-mono truncate leading-tight">
                        {api.label}
                      </h3>
                      <div className="flex items-center justify-between">
                        <Badge 
                          variant="default" 
                          className="text-[8px] font-mono uppercase px-1.5 py-0 h-4 bg-green-500/10 text-green-500 border-green-500/20"
                        >
                          Installed
                        </Badge>
                        {api.isCustom && <Badge variant="outline" className="text-[7px] h-3 px-1 bg-primary/5 text-primary border-primary/20">CUSTOM</Badge>}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Add New API Form Section */}
        <div className="mt-4 pt-6 border-t border-border shrink-0 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold font-mono text-primary flex items-center gap-2 uppercase tracking-widest">
              <Plus className="w-3.5 h-3.5" /> Integrate New Provider
            </h4>
            {targetName && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 text-[9px] font-mono text-muted-foreground hover:text-primary hover:bg-primary/5"
                onClick={() => { setTargetName(''); setTargetKey(''); }}
              >
                CLEAR FORM
              </Button>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-mono text-muted-foreground uppercase">Service Identifier (Name)</Label>
              <Input 
                value={targetName} 
                onChange={(e) => setTargetName(e.target.value)} 
                placeholder="e.g. FACEBOOK_SCRAPER_KEY" 
                className="h-9 text-xs font-mono bg-secondary/50 border-border focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-mono text-muted-foreground uppercase">Access Key / Secret</Label>
              <div className="relative">
                <Input 
                  value={targetKey} 
                  onChange={(e) => setTargetKey(e.target.value)} 
                  placeholder="Enter API key..." 
                  type={showKey ? "text" : "password"}
                  className="h-9 text-xs font-mono bg-secondary/50 border-border pr-10 focus:ring-1 focus:ring-primary/30"
                />
                <button 
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <Button 
            onClick={handleSaveApi} 
            disabled={!targetName.trim() || !targetKey.trim()}
            className="w-full h-9 text-xs font-mono shadow-md bg-primary hover:bg-primary/90 text-primary-foreground font-bold tracking-widest transition-all"
          >
            ACTIVATE INTEGRATION
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ApiDashboard;
