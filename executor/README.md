# executor/

**Owner:** both — background coordinates the loop; the content script performs real DOM actions.

## Responsibility

- Local Executor (architecture box 6): resolve an action target (`{ "type": "click", "target": "#submit" }`) against the real page DOM.
- Click and type on the live page; typing real values comes from the on-device mapping table, never placeholder strings.
- Loop back to the Capture Layer after actions complete.
- Safety: only act after the Policy Gate says allow/approved.

## Inputs

- Gate-approved action list from the background.
- The live page DOM (content script side).

## Outputs

- Executed DOM actions; completion status back to the background; triggers the next capture.

## Forbidden

- Executing actions without a gate decision.
- Sending page content anywhere.
- Typing placeholder strings (`PAN_1`) into real forms.
