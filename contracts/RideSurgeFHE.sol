// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract RideSurgeFHE is SepoliaConfig {
    struct RideDemand {
        euint32 encryptedZoneId;
        euint32 encryptedRequestCount;
        euint32 encryptedTimestamp;
    }

    struct DriverSupply {
        euint32 encryptedZoneId;
        euint32 encryptedAvailableDrivers;
        euint32 encryptedTimestamp;
    }

    struct SurgePricing {
        euint32 encryptedZoneId;
        euint32 encryptedMultiplier;
        euint32 encryptedBasePrice;
        bool isVerified;
    }

    uint256 public demandCount;
    uint256 public supplyCount;
    uint256 public pricingCount;
    mapping(uint256 => RideDemand) public rideDemands;
    mapping(uint256 => DriverSupply) public driverSupplies;
    mapping(uint256 => SurgePricing) public surgePricings;
    mapping(uint256 => uint256) private requestToDemandId;
    mapping(uint256 => uint256) private requestToSupplyId;
    mapping(uint256 => uint256) private requestToPricingId;
    
    event DemandRecorded(uint256 indexed demandId);
    event SupplyRecorded(uint256 indexed supplyId);
    event PricingCalculated(uint256 indexed pricingId);
    event PricingVerified(uint256 indexed pricingId);

    function recordDemand(
        euint32 zoneId,
        euint32 requestCount
    ) public {
        demandCount++;
        rideDemands[demandCount] = RideDemand({
            encryptedZoneId: zoneId,
            encryptedRequestCount: requestCount,
            encryptedTimestamp: FHE.asEuint32(uint32(block.timestamp))
        });
        emit DemandRecorded(demandCount);
    }

    function recordSupply(
        euint32 zoneId,
        euint32 availableDrivers
    ) public {
        supplyCount++;
        driverSupplies[supplyCount] = DriverSupply({
            encryptedZoneId: zoneId,
            encryptedAvailableDrivers: availableDrivers,
            encryptedTimestamp: FHE.asEuint32(uint32(block.timestamp))
        });
        emit SupplyRecorded(supplyCount);
    }

    function calculateSurgePricing(uint256 demandId, uint256 supplyId) public {
        require(demandId <= demandCount && supplyId <= supplyCount, "Invalid IDs");
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(rideDemands[demandId].encryptedZoneId);
        ciphertexts[1] = FHE.toBytes32(rideDemands[demandId].encryptedRequestCount);
        ciphertexts[2] = FHE.toBytes32(driverSupplies[supplyId].encryptedZoneId);
        ciphertexts[3] = FHE.toBytes32(driverSupplies[supplyId].encryptedAvailableDrivers);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.computePricing.selector);
        requestToDemandId[reqId] = demandId;
        requestToSupplyId[reqId] = supplyId;
    }

    function computePricing(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 demandId = requestToDemandId[requestId];
        uint256 supplyId = requestToSupplyId[requestId];
        require(demandId != 0 && supplyId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory data = abi.decode(cleartexts, (uint32[]));
        uint32 demandZone = data[0];
        uint32 requestCount = data[1];
        uint32 supplyZone = data[2];
        uint32 availableDrivers = data[3];

        require(demandZone == supplyZone, "Zone mismatch");

        // Simplified surge pricing calculation
        uint32 multiplier = 100;
        if (availableDrivers == 0) {
            multiplier = 300; // Max surge
        } else {
            uint32 ratio = (requestCount * 100) / availableDrivers;
            if (ratio > 200) multiplier = 250;
            else if (ratio > 150) multiplier = 200;
            else if (ratio > 100) multiplier = 150;
        }

        pricingCount++;
        surgePricings[pricingCount] = SurgePricing({
            encryptedZoneId: FHE.asEuint32(demandZone),
            encryptedMultiplier: FHE.asEuint32(multiplier),
            encryptedBasePrice: FHE.asEuint32(1000), // Example base price
            isVerified: false
        });

        emit PricingCalculated(pricingCount);
    }

    function verifyPricing(uint256 pricingId) public {
        require(pricingId <= pricingCount, "Invalid pricing ID");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(surgePricings[pricingId].encryptedZoneId);
        ciphertexts[1] = FHE.toBytes32(surgePricings[pricingId].encryptedMultiplier);
        ciphertexts[2] = FHE.toBytes32(surgePricings[pricingId].encryptedBasePrice);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.validatePricing.selector);
        requestToPricingId[reqId] = pricingId;
    }

    function validatePricing(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 pricingId = requestToPricingId[requestId];
        require(pricingId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory pricingData = abi.decode(cleartexts, (uint32[]));
        uint32 zoneId = pricingData[0];
        uint32 multiplier = pricingData[1];
        uint32 basePrice = pricingData[2];

        // Validate pricing logic (simplified example)
        bool isValid = multiplier >= 100 && multiplier <= 300 && basePrice > 0;
        
        if (isValid) {
            surgePricings[pricingId].isVerified = true;
            emit PricingVerified(pricingId);
        }
    }

    function requestPricingProof(uint256 pricingId) public {
        require(pricingId <= pricingCount, "Invalid pricing ID");
        require(surgePricings[pricingId].isVerified, "Not verified");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(surgePricings[pricingId].encryptedMultiplier);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMultiplier.selector);
        requestToPricingId[reqId] = pricingId;
    }

    function decryptMultiplier(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 pricingId = requestToPricingId[requestId];
        require(pricingId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 multiplier = abi.decode(cleartexts, (uint32));
        // Process decrypted multiplier as needed
    }

    function getPricingStatus(uint256 pricingId) public view returns (bool) {
        return surgePricings[pricingId].isVerified;
    }

    function getDemandCount() public view returns (uint256) {
        return demandCount;
    }

    function getSupplyCount() public view returns (uint256) {
        return supplyCount;
    }
}