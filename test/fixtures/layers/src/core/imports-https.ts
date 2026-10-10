import { get } from 'https';

export const fetchSchema = (url: string): void => {
  get(url);
};
