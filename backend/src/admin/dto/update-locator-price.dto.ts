import { IsInt, Max, Min } from 'class-validator';

import { LOCATOR_PRICE_MAX_COIN, LOCATOR_PRICE_MIN_COIN } from '../../economy/locator-price';

export class UpdateLocatorPriceDto {
  @IsInt()
  @Min(LOCATOR_PRICE_MIN_COIN)
  @Max(LOCATOR_PRICE_MAX_COIN)
  price!: number;
}
