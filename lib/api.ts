const API_BASE_URL = '/api';

export const geotechAPI = {
  getSitesGeoJSON: async (): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/sites`);
    if (!response.ok) throw new Error('Failed to fetch sites');
    return response.json();
  },

  getSites: async (page: number = 1, limit: number = 10): Promise<any[]> => {
    const response = await fetch(`${API_BASE_URL}/sites?page=${page}&limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch sites');
    return response.json();
  },

  getSite: async (id: number): Promise<any> => {
    const response = await fetch(`${API_BASE_URL}/sites/${id}`);
    if (!response.ok) throw new Error('Failed to fetch site');
    return response.json();
  }
};