import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => ({ gameId: params.gameId.toUpperCase() });
