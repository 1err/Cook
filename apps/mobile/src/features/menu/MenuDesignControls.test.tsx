import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { menuDesignForStyle } from '@cooking/shared';
import { MenuDesignControls } from './MenuDesignControls';
jest.mock('../../lib/i18n', () => ({ useT: () => (key: string) => key }));

test('layout, density and type controls independently preserve other design choices', async () => {
  const design = menuDesignForStyle('cozy-cafe');
  const onChange = jest.fn();
  await render(<MenuDesignControls design={design} onChange={onChange} />);
  await fireEvent.press(screen.getByRole('radio', { name: 'menu.studio.layout.category-board' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...design, layout: 'category-board', columns: 3, section_treatment: 'band', photo_frame: 'rounded', typography: { ...design.typography, align: 'center' }, artwork_placement: 'header' });
  await fireEvent.press(screen.getByRole('radio', { name: 'menu.studio.density.compact' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...design, density: 'compact' });
  await fireEvent.press(screen.getByRole('radio', { name: 'menu.studio.typography.playful' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...design, typography: { ...design.typography, title: 'playful' } });
});
