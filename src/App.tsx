import { useState } from 'react';
import { Network, Download, AlertCircle, Plus, Trash2 } from 'lucide-react';
import ValidationTable from './components/ValidationTable';
import MatrixTable from './components/MatrixTable';
import EntryModeSelector from './components/EntryModeSelector';
import {
  parseEndpointOutput,
  parseMoqueryOutput,
  validateVlanAllowances,
  generateCSV,
  extractVlanFromEpg,
  parseApicEndpointsAuto,
  extractEpgNamesFromMoquery,
  selectBestEpgMatch,
  type ValidationResult,
  type EndpointData,
  type PathAttachment,
  type AutoModeEndpoint
} from './utils/apicParser';
import { downloadCSV } from './utils/csvExport';

interface ValidationEntry {
  id: string;
  endpointInput: string;
  epgName: string;
  results: ValidationResult[] | null;
  endpointData: EndpointData | null;
}

function App() {
  const [entryMode, setEntryMode] = useState<'manual' | 'auto'>('manual');
  const [moqueryInput, setMoqueryInput] = useState('');
  const [apicRawInput, setApicRawInput] = useState('');
  const [entries, setEntries] = useState<ValidationEntry[]>([
    { id: '1', endpointInput: '', epgName: '', results: null, endpointData: null }
  ]);
  const [pathAttachments, setPathAttachments] = useState<PathAttachment[]>([]);
  const [autoEndpoints, setAutoEndpoints] = useState<AutoModeEndpoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addEntry = () => {
    setEntries([
      ...entries,
      { id: Date.now().toString(), endpointInput: '', epgName: '', results: null, endpointData: null }
    ]);
  };

  const removeEntry = (id: string) => {
    if (entries.length > 1) {
      setEntries(entries.filter(e => e.id !== id));
    }
  };

  const updateEntry = (id: string, field: 'endpointInput' | 'epgName', value: string) => {
    setEntries(entries.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const handleValidate = () => {
    setError(null);

    if (entryMode === 'manual') {
      handleValidateManual();
    } else {
      handleValidateAuto();
    }
  };

  const handleValidateManual = () => {
    const parsedMoquery = parseMoqueryOutput(moqueryInput);
    if (parsedMoquery.length === 0) {
      setError('Unable to parse moquery data. Please check your input.');
      return;
    }

    setPathAttachments(parsedMoquery);

    const updatedEntries = entries.map(entry => {
      if (!entry.endpointInput.trim()) {
        return entry;
      }

      const parsedEndpoint = parseEndpointOutput(entry.endpointInput);
      if (!parsedEndpoint) {
        return entry;
      }

      if (!entry.epgName.trim()) {
        return entry;
      }

      const vlanFromEpg = extractVlanFromEpg(entry.epgName);
      if (!vlanFromEpg) {
        return entry;
      }

      const endpointWithCorrectVlan = {
        ...parsedEndpoint,
        vlan: vlanFromEpg
      };

      const validationResults = validateVlanAllowances(endpointWithCorrectVlan, parsedMoquery);
      return {
        ...entry,
        results: validationResults,
        endpointData: endpointWithCorrectVlan
      };
    });

    setEntries(updatedEntries);
  };

  const handleValidateAuto = () => {
    const parsedMoquery = parseMoqueryOutput(moqueryInput);
    if (parsedMoquery.length === 0) {
      setError('Unable to parse moquery data. Please check your input.');
      return;
    }

    const parsedEndpoints = parseApicEndpointsAuto(apicRawInput);
    if (parsedEndpoints.length === 0) {
      setError('Unable to parse APIC endpoint data. Please check your input.');
      return;
    }

    // Extract EPG names from moquery data
    const epgsByVlan = extractEpgNamesFromMoquery(moqueryInput);

    setPathAttachments(parsedMoquery);
    setAutoEndpoints(parsedEndpoints);

    const groupedByVlan = new Map<string, AutoModeEndpoint[]>();
    parsedEndpoints.forEach(ep => {
      if (!groupedByVlan.has(ep.vlan)) {
        groupedByVlan.set(ep.vlan, []);
      }
      groupedByVlan.get(ep.vlan)!.push(ep);
    });

    const newEntries: ValidationEntry[] = [];

    Array.from(groupedByVlan.entries()).forEach(([vlan, endpoints], idx) => {
      const allPaths = Array.from(new Set(endpoints.map(ep => ep.path)));
      const pathIPMap = new Map<string, string>();
      endpoints.forEach(ep => {
        pathIPMap.set(ep.path, ep.ip);
      });

      const endpointData: EndpointData = {
        vlan,
        ip: endpoints[0]?.ip || '',
        paths: allPaths,
        pod: '',
        pathsWithIPs: pathIPMap
      };

      const results = validateVlanAllowances(endpointData, parsedMoquery);

      // Get all EPGs from moquery for this VLAN
      const epgList = epgsByVlan.get(vlan) || [endpoints[0]?.epg || `VLAN${vlan}`];

      // Select best matching EPG based on endpoint IP and path info
      const bestEpg = selectBestEpgMatch(
        endpoints[0]?.ip || '',
        epgList,
        allPaths
      );

      // If only one EPG matches, use it; otherwise create entry with best match
      newEntries.push({
        id: Date.now().toString() + idx,
        endpointInput: '',
        epgName: bestEpg || epgList[0] || `VLAN${vlan}`,
        results,
        endpointData
      });
    });

    setEntries(newEntries);
  };

  const handleExportAllCSV = () => {
    const allRows: string[] = [];

    entries.forEach(entry => {
      if (entry.results && entry.endpointData) {
        const notAllowed = entry.results.filter(r => r.status === 'not_allowed');
        if (notAllowed.length > 0) {
          const vlanNumber = extractVlanFromEpg(entry.epgName) || entry.endpointData!.vlan;

          // Format EPG: use as-is if it already starts with "EPG-", otherwise add "EPG-" prefix
          let epgFormatted = entry.epgName;
          if (!epgFormatted.toUpperCase().startsWith('EPG-')) {
            epgFormatted = `EPG-${entry.epgName}`;
          }

          notAllowed.forEach(result => {
            // Generate full path in moquery format
            let fullPath = '';
            let pod = 'pod-2'; // default fallback

            // Determine pod based on node number range
            const determinePodByNode = (nodeNum: string): string => {
              const num = parseInt(nodeNum);
              if (num >= 300 && num < 400) {
                return 'pod-1';
              } else if (num >= 400 && num < 500) {
                return 'pod-2';
              }
              return 'pod-2'; // fallback
            };

            // First, try to find exact match in moquery data
            const normalizedPathName = result.path.trim().replace(/[\[\]]/g, '').toLowerCase();
            let matchedAttachment: typeof pathAttachments[0] | null = null;

            for (const attachment of pathAttachments) {
              const attachmentPath = attachment.path.trim().replace(/[\[\]]/g, '').toLowerCase();
              if (attachmentPath === normalizedPathName) {
                matchedAttachment = attachment;
                fullPath = attachment.fullPath;
                break;
              }
            }

            // If exact match found, use it
            if (matchedAttachment) {
              allRows.push(`${vlanNumber},${epgFormatted},${fullPath}`);
              return;
            }

            // Otherwise, construct the path
            // Check if it's a VPC path (format: XXX-YYY-VPC-...)
            const vpcMatch = result.path.match(/(\d+)-(\d+)-VPC/);
            if (vpcMatch) {
              const node1 = vpcMatch[1];
              const node2 = vpcMatch[2];
              pod = determinePodByNode(node1);
              fullPath = `${pod}/protpaths-${node1}-${node2}/pathep-[${result.path}]`;
            } else {
              // Single path - could be "eth1/5" format
              const singleMatch = result.path.match(/^(\d+)[-\/]/);
              if (singleMatch) {
                // Path like "303/eth1/5" or "303-something"
                const node = singleMatch[1];
                pod = determinePodByNode(node);
                fullPath = `${pod}/paths-${node}/pathep-[${result.path}]`;
              } else if (entry.endpointData?.pathsWithNodes?.has(result.path)) {
                // Path like "eth1/5" - get node from pathsWithNodes map
                const node = entry.endpointData.pathsWithNodes.get(result.path)!;
                pod = determinePodByNode(node);
                fullPath = `${pod}/paths-${node}/pathep-[${result.path}]`;
              } else {
                // Fallback - can't determine node
                fullPath = `${pod}/paths-XXX/pathep-[${result.path}]`;
              }
            }

            allRows.push(`${vlanNumber},${epgFormatted},${fullPath}`);
          });
        }
      }
    });

    if (allRows.length === 0) {
      setError('No validation issues to export.');
      return;
    }

    const csv = 'VLAN,EPG,PATH\n' + allRows.join('\n');
    const filename = `vlan-validation-${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(csv, filename);
  };

  const totalNotAllowed = entries.reduce((sum, entry) => {
    return sum + (entry.results?.filter(r => r.status === 'not_allowed').length || 0);
  }, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-8 py-6">
            <div className="flex items-center gap-3">
              <Network className="w-8 h-8 text-white" />
              <div>
                <h1 className="text-2xl font-bold text-white">
                  APIC VLAN Validation Tool
                </h1>
                <p className="text-slate-300 text-sm mt-1">
                  Parse CLI output and validate VLAN allowances across paths
                </p>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Entry Mode
              </label>
              <EntryModeSelector mode={entryMode} onChange={setEntryMode} />
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Moquery Data (Required for both modes)
                <span className="text-slate-500 font-normal ml-2">
                  Contains EPG names and path information
                </span>
              </label>
              <textarea
                value={moqueryInput}
                onChange={(e) => setMoqueryInput(e.target.value)}
                placeholder='Paste output from: moquery -c fvRsPathAtt -f &#39;fv.RsPathAtt.encap=="vlan-XXX"&#39; | grep dn&#10;&#10;Example:&#10;dn : uni/tn-MDR-SF-DC/ap-MDR-SF/epg-(x)-(x)-(x)-(X)/rspathAtt-[topology/pod-2/paths-410/pathep-[eth1/1]]'
                className="w-full h-40 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-none font-mono text-sm bg-white"
              />
              <p className="text-xs text-slate-600 mt-2">
                {entryMode === 'auto' ? (
                  <span className="font-medium text-green-700">Auto mode: EPG names will be extracted automatically from this data</span>
                ) : (
                  <span>This data provides VLAN-to-path mappings for validation</span>
                )}
              </p>
            </div>

            {entryMode === 'manual' ? (
              <div className="border-t border-slate-200 pt-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-semibold text-blue-900 mb-1">Manual Mode</h4>
                  <p className="text-xs text-blue-700">
                    In this mode, you need to manually enter endpoint data and EPG names for each validation entry.
                  </p>
                </div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">
                    Endpoint Validations
                  </h3>
                  <button
                    onClick={addEntry}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Entry
                  </button>
                </div>

                <div className="space-y-4">
                  {entries.map((entry, index) => (
                    <div
                      key={entry.id}
                      className="border border-slate-200 rounded-lg p-4 bg-slate-50"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-slate-700">
                          Entry #{index + 1}
                        </span>
                        {entries.length > 1 && (
                          <button
                            onClick={() => removeEntry(entry.id)}
                            className="text-red-600 hover:text-red-700 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Endpoint Data
                          </label>
                          <textarea
                            value={entry.endpointInput}
                            onChange={(e) => updateEntry(entry.id, 'endpointInput', e.target.value)}
                            placeholder="Paste output from: show endpoints ip x.x.x.x"
                            className="w-full h-32 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-none font-mono text-xs"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            EPG Name
                          </label>
                          <input
                            type="text"
                            value={entry.epgName}
                            onChange={(e) => updateEntry(entry.id, 'epgName', e.target.value)}
                            placeholder="e.g., EPG-VLAN623-10.204.85.128-27"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="border-t border-slate-200 pt-6">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-semibold text-green-900 mb-1">Auto Mode</h4>
                  <p className="text-xs text-green-700 mb-2">
                    In this mode, EPG names are automatically extracted from the moquery data above. You only need to paste the endpoint output below.
                  </p>
                  <p className="text-xs text-green-700">
                    No need to manually enter EPG names - they will be matched automatically based on VLAN numbers.
                  </p>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">
                  APIC Endpoint Data
                </h3>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    APIC CLI Output (show endpoints ip...)
                  </label>
                  <textarea
                    value={apicRawInput}
                    onChange={(e) => setApicRawInput(e.target.value)}
                    placeholder="Paste output from multiple: show endpoints ip 10.254.244.x commands"
                    className="w-full h-64 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-none font-mono text-sm"
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    Paste the complete output from all "show endpoints ip" commands for automatic parsing
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleValidate}
                className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg transition-colors shadow-sm"
              >
                Validate All
              </button>

              {totalNotAllowed > 0 && (
                <button
                  onClick={handleExportAllCSV}
                  className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors shadow-sm flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export CSV ({totalNotAllowed} paths)
                </button>
              )}
            </div>
          </div>
        </div>

        {entries.map((entry, index) => (
          entry.results && entry.endpointData && (
            <div key={entry.id} className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 p-8">
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                Entry #{index + 1}: VLAN {entry.endpointData.vlan} - {entry.epgName}
              </h2>
              <ValidationTable results={entry.results} vlan={entry.endpointData.vlan} />
            </div>
          )
        ))}

        {entries.some(e => e.results && e.endpointData) && (
          <MatrixTable
            allEntries={entries
              .filter(e => e.results && e.endpointData)
              .map(e => ({
                vlan: e.endpointData!.vlan,
                epgName: e.epgName,
                results: e.results!,
                endpointData: e.endpointData!
              }))}
            pathAttachments={pathAttachments}
          />
        )}
      </div>
    </div>
  );
}

export default App;
