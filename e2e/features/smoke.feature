Feature: Smoke

  Scenario: Yugilife loads
    Given I open the Yugilife app
    Then I see the card creation heading

  Scenario: The landing scene is ready when navigating home
    Given I open the inventory
    When I navigate to the Yugilife home
    Then the landing scene is rendered

  Scenario: Saved card fields survive a browser refresh
    Given I open the card builder
    When I change the card name to "Refresh-safe card"
    And I save the card
    And I refresh the card builder
    Then the card name is "Refresh-safe card"

  Scenario: The build entry reopens the active card and can start a new one
    Given I open the card builder
    When I change the card name to "Active inventory card"
    And I save the card
    And I reopen the card builder entry
    Then the card name is "Active inventory card"
    When I create a new card from the builder
    Then the card name is "Sample Card Title"

  Scenario: Raster export controls preserve the native card aspect ratio
    Given I open the card builder
    When I select WebP at 2× export size
    Then the export dimensions are "1626 × 2370"
    And the lossy image quality control is visible

  Scenario: Inventory cards can be named and duplicated independently
    Given I open the inventory
    When I create an inventory card
    And I change the card name to "Inventory card"
    And I save the card
    And I return to the inventory
    Then the inventory contains "Inventory card"
    When I duplicate the selected inventory card
    Then the inventory contains "Inventory card copy"
    And the inventory card "Inventory card copy" has a preview

  Scenario: A new inventory starts with a diverse sample collection
    Given I open the inventory
    Then the inventory has 8 cards
    And the inventory contains "Odd-Eyes Arc Pendulum Dragon"
    And the inventory contains "Dinowrestler Pankratops"

  Scenario: Salamangreat preview uses outlined text in Firefox
    Given I open the Salamangreat card builder
    Then the Salamangreat preview uses outlined glyphs in Firefox
