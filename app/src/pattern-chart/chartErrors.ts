export class ChartSharingUnavailableError extends Error {
  constructor() {
    super('sharing_unavailable');
    this.name = 'ChartSharingUnavailableError';
  }
}
