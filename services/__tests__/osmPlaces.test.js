jest.mock('axios');
const axios = require('axios');
const osm = require('../osmPlacesService');

const element = (id, tags, lat = 28.6140, lon = 77.2091) => ({ type: 'node', id, lat, lon, tags });

describe('osmPlacesService', () => {
  beforeEach(() => {
    osm._clearCache();
    axios.post.mockReset();
  });

  test('maps OSM tags to Google-style place types', () => {
    expect(osm._typesForTags({ amenity: 'hospital' })).toEqual(
      expect.arrayContaining(['hospital', 'health', 'point_of_interest'])
    );
    expect(osm._typesForTags({ railway: 'station', subway: 'yes' })).toEqual(
      expect.arrayContaining(['transit_station', 'subway_station'])
    );
    expect(osm._typesForTags({ highway: 'residential' })).toEqual([]);
  });

  test('leaves shops/restaurants out of large-radius queries', () => {
    expect(osm._buildQuery(28.6, 77.2, 1000)).toContain('nwr["shop"]');
    expect(osm._buildQuery(28.6, 77.2, 10000)).not.toContain('nwr["shop"]');
  });

  test('uses way centers and falls back when a place has no name', () => {
    const place = osm._toPlace({ type: 'way', id: 7, center: { lat: 1, lon: 2 }, tags: { amenity: 'school' } });
    expect(place).toMatchObject({ name: 'Unnamed place', place_id: 'osm:way/7', geometry: { location: { lat: 1, lng: 2 } } });
  });

  test('one request serves every type at the same point, nearest first', async () => {
    axios.post.mockResolvedValue({
      data: {
        elements: [
          element(1, { amenity: 'hospital', name: 'Far Hospital' }, 28.63, 77.22),
          element(2, { amenity: 'hospital', name: 'Near Hospital' }),
          element(3, { amenity: 'police', name: 'Police Station' }),
        ],
      },
    });

    const hospitals = await osm.nearbySearch(28.6139, 77.2090, 'hospital', 5000);
    const callsForOneFetch = axios.post.mock.calls.length; // one POST per Overpass instance (raced)
    const police = await osm.nearbySearch(28.6139, 77.2090, 'police', 5000);
    const smaller = await osm.nearbySearch(28.6139, 77.2090, 'hospital', 3000);

    expect(hospitals.map((p) => p.name)).toEqual(['Near Hospital', 'Far Hospital']);
    expect(police).toHaveLength(1);
    expect(smaller.map((p) => p.name)).toEqual(['Near Hospital', 'Far Hospital']);
    expect(axios.post).toHaveBeenCalledTimes(callsForOneFetch);
  });

  test('fails fast with a non-retryable error once every instance has failed', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 429 } }));

    const first = osm.nearbySearch(28.6139, 77.2090, 'hospital', 5000);
    await expect(first).rejects.toMatchObject({ retryable: false });
    const calls = axios.post.mock.calls.length;

    await expect(osm.nearbySearch(28.6139, 77.2090, 'school', 5000)).rejects.toThrow(/OpenStreetMap lookup failed/);
    expect(axios.post.mock.calls.length).toBe(calls); // served from the failure cache
  });

  test('rejects unsupported place types without a request', async () => {
    await expect(osm.nearbySearch(1, 2, 'casino', 1000)).rejects.toMatchObject({ retryable: false });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
