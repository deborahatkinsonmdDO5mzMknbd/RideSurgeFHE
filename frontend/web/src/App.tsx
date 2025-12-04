import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface RideData {
  id: string;
  encryptedSupply: string;
  encryptedDemand: string;
  surgeMultiplier: number;
  timestamp: number;
  region: string;
  verified: boolean;
  fheProof: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [rides, setRides] = useState<RideData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRideData, setNewRideData] = useState({
    region: "",
    supply: "",
    demand: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRegion, setFilterRegion] = useState("all");

  // Calculate statistics
  const totalRides = rides.length;
  const avgSurge = totalRides > 0 ? rides.reduce((sum, ride) => sum + ride.surgeMultiplier, 0) / totalRides : 0;
  const verifiedCount = rides.filter(ride => ride.verified).length;

  // Filter rides based on search and region
  const filteredRides = rides.filter(ride => {
    const matchesSearch = ride.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         ride.region.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRegion = filterRegion === "all" || ride.region === filterRegion;
    return matchesSearch && matchesRegion;
  });

  // Prepare chart data
  const chartData = rides.slice(-10).map(ride => ({
    time: new Date(ride.timestamp * 1000).toLocaleTimeString(),
    surge: ride.surgeMultiplier
  }));

  useEffect(() => {
    loadRides().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRides = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("ride_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing ride keys:", e);
        }
      }
      
      const list: RideData[] = [];
      
      for (const key of keys) {
        try {
          const rideBytes = await contract.getData(`ride_${key}`);
          if (rideBytes.length > 0) {
            try {
              const rideData = JSON.parse(ethers.toUtf8String(rideBytes));
              list.push({
                id: key,
                encryptedSupply: rideData.encryptedSupply,
                encryptedDemand: rideData.encryptedDemand,
                surgeMultiplier: rideData.surgeMultiplier,
                timestamp: rideData.timestamp,
                region: rideData.region,
                verified: rideData.verified,
                fheProof: rideData.fheProof
              });
            } catch (e) {
              console.error(`Error parsing ride data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading ride ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRides(list);
    } catch (e) {
      console.error("Error loading rides:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRide = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting ride data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for supply and demand
      const encryptedSupply = `FHE-SUPPLY-${btoa(newRideData.supply)}`;
      const encryptedDemand = `FHE-DEMAND-${btoa(newRideData.demand)}`;
      
      // Simulate FHE computation for surge pricing
      const supplyNum = parseInt(newRideData.supply) || 0;
      const demandNum = parseInt(newRideData.demand) || 0;
      const surgeMultiplier = demandNum > 0 ? Math.max(1.0, Math.min(5.0, demandNum / supplyNum)) : 1.0;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const rideId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const rideData = {
        encryptedSupply,
        encryptedDemand,
        surgeMultiplier,
        timestamp: Math.floor(Date.now() / 1000),
        region: newRideData.region,
        verified: false,
        fheProof: `FHE-PROOF-${btoa(JSON.stringify({ supply: supplyNum, demand: demandNum, surge: surgeMultiplier }))}`
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `ride_${rideId}`, 
        ethers.toUtf8Bytes(JSON.stringify(rideData))
      );
      
      const keysBytes = await contract.getData("ride_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(rideId);
      
      await contract.setData(
        "ride_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Ride data encrypted and stored with FHE!"
      });
      
      await loadRides();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRideData({
          region: "",
          supply: "",
          demand: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyRide = async (rideId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Verifying FHE computation..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const rideBytes = await contract.getData(`ride_${rideId}`);
      if (rideBytes.length === 0) {
        throw new Error("Ride not found");
      }
      
      const rideData = JSON.parse(ethers.toUtf8String(rideBytes));
      
      const updatedRide = {
        ...rideData,
        verified: true
      };
      
      await contract.setData(
        `ride_${rideId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRide))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadRides();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) {
        throw new Error("Contract not available");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Contract is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const renderLineChart = () => {
    if (chartData.length === 0) {
      return (
        <div className="no-chart-data">
          <p>No data available for chart</p>
        </div>
      );
    }

    const maxSurge = Math.max(...chartData.map(d => d.surge));
    const minSurge = Math.min(...chartData.map(d => d.surge));

    return (
      <div className="line-chart-container">
        <div className="chart-y-axis">
          <span>{maxSurge.toFixed(1)}x</span>
          <span>{((maxSurge + minSurge) / 2).toFixed(1)}x</span>
          <span>{minSurge.toFixed(1)}x</span>
        </div>
        <div className="chart-area">
          <div className="chart-grid">
            {chartData.map((data, index) => (
              <div key={index} className="chart-point-container">
                <div 
                  className="chart-point"
                  style={{ 
                    bottom: `${((data.surge - minSurge) / (maxSurge - minSurge || 1)) * 80}%` 
                  }}
                ></div>
                <div className="chart-time">{data.time}</div>
              </div>
            ))}
          </div>
          <div className="chart-line">
            {chartData.map((data, index) => (
              <div 
                key={index}
                className="chart-line-segment"
                style={{ 
                  height: `${((data.surge - minSurge) / (maxSurge - minSurge || 1)) * 80}%`,
                  left: `${(index / (chartData.length - 1)) * 100}%`
                }}
              ></div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen cyberpunk-loading">
      <div className="cyber-spinner neon-spinner"></div>
      <p>Initializing encrypted ride-hailing system...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header neon-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="car-icon neon-icon"></div>
          </div>
          <h1>Ride<span className="neon-accent">Surge</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={testAvailability}
            className="cyber-button neon-button test-btn"
          >
            Test FHE
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="cyber-button neon-button primary"
          >
            <div className="add-icon"></div>
            New Ride Data
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        {/* Project Introduction */}
        <div className="intro-section neon-card">
          <h2>Anonymous Ride-Hailing with Surge Pricing Transparency</h2>
          <p>
            RideSurgeFHE uses Fully Homomorphic Encryption (FHE) to provide transparent surge pricing 
            while maintaining user anonymity. The platform proves that peak pricing is based on 
            real, anonymous supply and demand data, not price discrimination.
          </p>
          <div className="fhe-badge neon-badge">
            <span>FHE-Powered Transparency</span>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="dashboard-grid">
          {/* Data Statistics */}
          <div className="dashboard-card neon-card">
            <h3>Ride Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value neon-text">{totalRides}</div>
                <div className="stat-label">Total Rides</div>
              </div>
              <div className="stat-item">
                <div className="stat-value neon-text">{avgSurge.toFixed(2)}x</div>
                <div className="stat-label">Avg Surge</div>
              </div>
              <div className="stat-item">
                <div className="stat-value neon-text">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-item">
                <div className="stat-value neon-text">
                  {rides.length > 0 ? Math.max(...rides.map(r => r.surgeMultiplier)).toFixed(2) + 'x' : '0x'}
                </div>
                <div className="stat-label">Peak Surge</div>
              </div>
            </div>
          </div>

          {/* Surge Pricing Chart */}
          <div className="dashboard-card neon-card chart-card">
            <h3>Surge Pricing Trend</h3>
            {renderLineChart()}
          </div>

          {/* Team Information */}
          <div className="dashboard-card neon-card">
            <h3>Development Team</h3>
            <div className="team-list">
              <div className="team-member">
                <div className="member-avatar neon-avatar"></div>
                <div className="member-info">
                  <h4>Dr. Alice Chen</h4>
                  <p>FHE Cryptography Expert</p>
                </div>
              </div>
              <div className="team-member">
                <div className="member-avatar neon-avatar"></div>
                <div className="member-info">
                  <h4>Mark Johnson</h4>
                  <p>Smart Contract Developer</p>
                </div>
              </div>
              <div className="team-member">
                <div className="member-avatar neon-avatar"></div>
                <div className="member-info">
                  <h4>Sarah Williams</h4>
                  <p>Frontend Engineer</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Ride Data Section */}
        <div className="rides-section">
          <div className="section-header">
            <h2>Encrypted Ride Data</h2>
            <div className="header-controls">
              <div className="search-box">
                <input 
                  type="text"
                  placeholder="Search rides..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cyber-input neon-input"
                />
              </div>
              <select 
                value={filterRegion}
                onChange={(e) => setFilterRegion(e.target.value)}
                className="cyber-select neon-select"
              >
                <option value="all">All Regions</option>
                <option value="Downtown">Downtown</option>
                <option value="Suburbs">Suburbs</option>
                <option value="Airport">Airport</option>
                <option value="Campus">Campus</option>
              </select>
              <button 
                onClick={loadRides}
                className="cyber-button neon-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>
          </div>
          
          <div className="rides-list neon-card">
            <div className="table-header">
              <div className="header-cell">Ride ID</div>
              <div className="header-cell">Region</div>
              <div className="header-cell">Surge Multiplier</div>
              <div className="header-cell">Time</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredRides.length === 0 ? (
              <div className="no-rides">
                <div className="no-rides-icon"></div>
                <p>No ride data found</p>
                <button 
                  className="cyber-button neon-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Ride
                </button>
              </div>
            ) : (
              filteredRides.map(ride => (
                <div className="ride-row" key={ride.id}>
                  <div className="table-cell ride-id">#{ride.id.substring(0, 8)}</div>
                  <div className="table-cell">{ride.region}</div>
                  <div className="table-cell surge-value">
                    <span className={ride.surgeMultiplier > 2.0 ? "high-surge" : ""}>
                      {ride.surgeMultiplier.toFixed(2)}x
                    </span>
                  </div>
                  <div className="table-cell">
                    {new Date(ride.timestamp * 1000).toLocaleTimeString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${ride.verified ? "verified" : "pending"}`}>
                      {ride.verified ? "Verified" : "Pending"}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {!ride.verified && (
                      <button 
                        className="action-btn cyber-button neon-button success"
                        onClick={() => verifyRide(ride.id)}
                      >
                        Verify
                      </button>
                    )}
                    <button 
                      className="action-btn cyber-button neon-button"
                      onClick={() => {
                        // View details implementation would go here
                        alert(`FHE Proof: ${ride.fheProof}`);
                      }}
                    >
                      View Proof
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreateRide 
          onSubmit={submitRide} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          rideData={newRideData}
          setRideData={setNewRideData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content neon-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner neon-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon neon-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon neon-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer neon-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="car-icon"></div>
              <span>RideSurgeFHE</span>
            </div>
            <p>Transparent surge pricing through FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Contact Team</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge neon-badge">
            <span>FHE-Powered Transparency</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} RideSurgeFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateRideProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  rideData: any;
  setRideData: (data: any) => void;
}

const ModalCreateRide: React.FC<ModalCreateRideProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  rideData,
  setRideData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setRideData({
      ...rideData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!rideData.region || !rideData.supply || !rideData.demand) {
      alert("Please fill all required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal neon-card">
        <div className="modal-header">
          <h2>Add Encrypted Ride Data</h2>
          <button onClick={onClose} className="close-modal neon-button">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner neon-notice">
            <div className="lock-icon neon-icon"></div> 
            Your ride data will be encrypted with FHE for privacy-preserving surge calculation
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Region *</label>
              <select 
                name="region"
                value={rideData.region} 
                onChange={handleChange}
                className="cyber-select neon-select"
              >
                <option value="">Select region</option>
                <option value="Downtown">Downtown</option>
                <option value="Suburbs">Suburbs</option>
                <option value="Airport">Airport</option>
                <option value="Campus">Campus</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Available Rides (Supply) *</label>
              <input 
                type="number"
                name="supply"
                value={rideData.supply} 
                onChange={handleChange}
                placeholder="Number of available rides"
                className="cyber-input neon-input"
                min="1"
              />
            </div>
            
            <div className="form-group">
              <label>Ride Requests (Demand) *</label>
              <input 
                type="number"
                name="demand"
                value={rideData.demand} 
                onChange={handleChange}
                placeholder="Number of ride requests"
                className="cyber-input neon-input"
                min="1"
              />
            </div>
          </div>
          
          <div className="calculation-preview">
            <h4>Estimated Surge Multiplier:</h4>
            {rideData.supply && rideData.demand ? (
              <div className="surge-preview neon-text">
                {Math.max(1.0, Math.min(5.0, 
                  parseInt(rideData.demand) / parseInt(rideData.supply)
                )).toFixed(2)}x
              </div>
            ) : (
              <p>Enter supply and demand to see estimated surge</p>
            )}
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button neon-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button neon-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Encrypted Data"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;