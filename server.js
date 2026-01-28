const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files from current directory

// Google Sheets API setup
// Using public sheet access (no auth needed if sheet is set to "Anyone with link can view")
// Set CENTRAL_SHEET_ID environment variable or update the default below
// To get the sheet ID from a Google Sheets URL: https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
const CENTRAL_SHEET_ID = process.env.CENTRAL_SHEET_ID || '1PaqcX2BSypJjLBDMA3DnlAxCHK5y0TWMSbCIkTScIQU';
const ACTIONS_SHEET_ID = process.env.ACTIONS_SHEET_ID || '1g6gmdXF1yjrejpmT3HTY7JI1Zzb7jErYZQ2pwiH37I0';

// Helper function to get sheet gid (grid ID) from sheet name for public sheets
async function getSheetGid(sheetId, sheetName) {
  try {
    const https = require('https');
    const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
    
    return new Promise((resolve, reject) => {
      https.get(metadataUrl, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk.toString();
        });
        
        response.on('end', () => {
          try {
            const metadata = JSON.parse(data);
            if (metadata.sheets) {
              // Find the sheet with matching name (case-insensitive)
              const sheet = metadata.sheets.find(s => 
                s.properties && s.properties.title && 
                s.properties.title.toLowerCase() === sheetName.toLowerCase()
              );
              
              if (sheet && sheet.properties && sheet.properties.sheetId !== undefined) {
                console.log(`Found sheet "${sheetName}" with gid: ${sheet.properties.sheetId}`);
                resolve(sheet.properties.sheetId);
              } else {
                console.log(`Sheet "${sheetName}" not found. Available sheets:`, 
                  metadata.sheets.map(s => s.properties?.title).filter(Boolean));
                reject(new Error(`Sheet "${sheetName}" not found in spreadsheet`));
              }
            } else {
              reject(new Error('Could not parse sheet metadata'));
            }
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  } catch (error) {
    throw error;
  }
}

// Helper function to fetch Google Sheet data (public access)
async function fetchPublicSheet(sheetId, range = 'A1:ZZ1000', sheetName = null) {
  try {
    // If sheetName is provided, get the gid for that sheet
    let gid = '0'; // Default to first sheet
    if (sheetName) {
      try {
        gid = await getSheetGid(sheetId, sheetName);
      } catch (error) {
        console.error(`Error getting gid for sheet "${sheetName}":`, error.message);
        // Fall back to default gid=0
        gid = '0';
      }
    }
    
    // For public sheets, we can use CSV export
    // Try multiple URL formats
    const urls = [
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`
    ];
    
    const https = require('https');
    const http = require('http');
    
    // Try each URL until one works
    for (const url of urls) {
      try {
        const result = await new Promise((resolve, reject) => {
          const protocol = url.startsWith('https') ? https : http;
          
          const request = protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
              const redirectUrl = response.headers.location;
              if (redirectUrl) {
                console.log('Following redirect to:', redirectUrl);
                // Create new request for redirect
                const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
                const redirectRequest = redirectProtocol.get(redirectUrl, (redirectResponse) => {
                  handleResponse(redirectResponse, resolve, reject);
                });
                redirectRequest.on('error', reject);
                redirectRequest.setTimeout(10000, () => {
                  redirectRequest.destroy();
                  reject(new Error('Request timeout'));
                });
                return;
              }
            }
            
            handleResponse(response, resolve, reject);
          });
          
          request.on('error', (error) => {
            console.error('Request error for URL:', url, error);
            reject(error);
          });
          
          request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
          });
        });
        
        // If we got here, the request succeeded
        return result;
      } catch (error) {
        console.log(`Failed to fetch with URL: ${url}`, error.message);
        // Continue to next URL
        continue;
      }
    }
    
    // If all URLs failed, throw error
    throw new Error('All export URL formats failed. Please ensure the sheet is set to "Anyone with the link can view" and try publishing it to web (File > Share > Publish to web).');
    
    function handleResponse(response, resolve, reject) {
      if (response.statusCode !== 200) {
        console.error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      let csvText = '';
      response.on('data', (chunk) => {
        csvText += chunk.toString();
      });
      
      response.on('end', () => {
        try {
          // Check if we got HTML instead of CSV (common when sheet isn't public)
          if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
            console.error('Received HTML instead of CSV. Sheet may not be publicly accessible.');
            reject(new Error('Sheet is not publicly accessible. Please ensure it is set to "Anyone with the link can view" and try publishing it to web (File > Share > Publish to web).'));
            return;
          }
          
          // Parse CSV
          const lines = csvText.split('\n').filter(line => line.trim());
          if (lines.length === 0) {
            resolve({ headers: [], rows: [] });
            return;
          }
          
          // Parse header
          const headers = parseCSVLine(lines[0]);
          console.log('Parsed headers:', headers);
          
          // Parse rows
          const rows = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const row = {};
            headers.forEach((header, index) => {
              row[header] = values[index] || '';
            });
            return row;
          });
          
          console.log(`Parsed ${rows.length} rows`);
          resolve({ headers, rows });
        } catch (error) {
          console.error('Error parsing CSV:', error);
          reject(error);
        }
      });
    }
  } catch (error) {
    console.error('Error fetching sheet:', error);
    throw error;
  }
}

// Simple CSV parser (handles quoted fields)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  result.push(current.trim());
  
  return result;
}

// API Route: Homepage Feed
app.get('/api/homepage-feed', async (req, res) => {
  try {
    console.log('Fetching homepage feed from central sheet...');
    
    // Fetch the central sheet data
    const { headers, rows } = await fetchPublicSheet(CENTRAL_SHEET_ID);
    
    // The sheet structure: Column A is "Label", Columns B, C, D, etc. are "Content"
    // Each row represents one item with a label and multiple content fields
    
    const result = {
      items: [],
      alert: null
    };
    
    // Column A is the label column
    const labelCol = headers[0] || 'Label';
    // Column B is the first content column
    const contentCol = headers[1] || 'Content';
    
    // Check row 2 (index 0 in rows array) for alert
    // A2 should contain "ALERT" and B2 contains the alert message
    if (rows.length > 0) {
      const alertRow = rows[0]; // First data row = row 2 in spreadsheet
      const alertLabel = (alertRow[labelCol] || '').trim().toUpperCase();
      // Check if A2 is "ALERT" (case-insensitive)
      if (alertLabel === 'ALERT' || alertLabel === 'URGENT') {
        const alertText = (alertRow[contentCol] || '').trim();
        if (alertText) {
          result.alert = alertText;
        }
      }
    }
    
    // Process each row (skip row 2 if it's the alert)
    rows.forEach((row, index) => {
      // Skip row 2 (index 0) as it's reserved for alerts
      if (index === 0) {
        const rowLabel = (row[labelCol] || '').trim().toUpperCase();
        // Only skip if it's actually an alert row
        if (rowLabel === 'ALERT' || rowLabel === 'URGENT') {
          return;
        }
      }
      
      const label = (row[labelCol] || '').trim();
      
      // Skip rows without a label
      if (!label) return;
      
      // Get all content columns (B, C, D, etc.) - everything after the label column
      const content = [];
      for (let i = 1; i < headers.length; i++) {
        const contentValue = (row[headers[i]] || '').trim();
        if (contentValue) {
          content.push(contentValue);
        }
      }
      
      // Only add items that have at least a label
      if (label) {
        result.items.push({
          label: label,
          content: content
        });
      }
    });
    
    console.log('Homepage feed fetched successfully');
    res.json(result);
  } catch (error) {
    console.error('Error fetching homepage feed:', error);
    res.status(500).json({ 
      error: 'Failed to fetch homepage feed',
      message: error.message 
    });
  }
});

// API Route: Actions Feed
app.get('/api/actions-feed', async (req, res) => {
  try {
    console.log('Fetching actions feed from actions sheet...');
    
    // Fetch from the dedicated actions sheet (no tab name needed - uses first sheet)
    const { headers, rows } = await fetchPublicSheet(ACTIONS_SHEET_ID);
    
    console.log('Headers found:', headers);
    console.log('Number of rows:', rows.length);
    
    const result = {
      items: []
    };
    
    // Column A is the label column
    const labelCol = headers[0] || 'Label';
    
    // Look for ContentA, ContentB, ContentC, ContentD columns (case-insensitive)
    const contentCols = ['ContentA', 'ContentB', 'ContentC', 'ContentD'].map(colName => {
      const found = headers.find(h => h.trim().toLowerCase() === colName.toLowerCase());
      if (found) {
        console.log(`Found column: ${found} (looking for ${colName})`);
      }
      return found;
    }).filter(Boolean);
    
    console.log('Content columns found:', contentCols);
    
    // Process each row
    rows.forEach((row, index) => {
      const label = (row[labelCol] || '').trim();
      
      // Skip rows without a label
      if (!label) return;
      
      // Get content from ContentA, ContentB, ContentC, ContentD columns
      const content = [];
      contentCols.forEach(colName => {
        const contentValue = (row[colName] || '').trim();
        if (contentValue) {
          content.push(contentValue);
        }
      });
      
      // Only add items that have at least a label
      if (label) {
        result.items.push({
          label: label,
          content: content
        });
        console.log(`Added action item: ${label} with ${content.length} content fields`);
      }
    });
    
    console.log(`Actions feed fetched successfully. Total items: ${result.items.length}`);
    res.json(result);
  } catch (error) {
    console.error('Error fetching actions feed:', error);
    res.status(500).json({ 
      error: 'Failed to fetch actions feed',
      message: error.message 
    });
  }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Central sheet ID (announcements): ${CENTRAL_SHEET_ID}`);
  console.log(`Actions sheet ID: ${ACTIONS_SHEET_ID}`);
  console.log(`To change sheets, update the IDs in server.js or set environment variables`);
});

