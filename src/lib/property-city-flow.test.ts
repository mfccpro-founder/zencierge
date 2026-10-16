import assert from "node:assert/strict";
import type { Property } from "./dashboard-data";
import { propertyFromRow, propertyToRow } from "./supabase-listings";
import { validatePropertyWriteIdentity } from "./property-write-validation";

const identity = validatePropertyWriteIdentity({
  id: " prop-lantana-test ",
  name: " Lantana Test Property ",
  city: " Lantana ",
});
assert.deepEqual(identity, {
  ok: true,
  value: { id: "prop-lantana-test", name: "Lantana Test Property", city: "Lantana" },
});

const property: Property = {
  id: identity.ok ? identity.value.id : "",
  name: identity.ok ? identity.value.name : "",
  city: identity.ok ? identity.value.city : "",
  address: "1 Test Avenue",
  status: "Vacant",
  revenue: "$0",
  doorCode: "",
  smartlock: "",
  wifiNetwork: "",
  wifiPassword: "",
  parking: "",
  gateCode: "",
  checkIn: "3:00 PM",
  checkOut: "11:00 AM",
  currentGuest: null,
  trash: "",
  handbook: "",
  assignedAvatarName: "Isabela",
  assignedPhoneNumber: "",
  avatarSystemPrompt: "",
  timezone: "America/New_York",
};

const storedRow = propertyToRow(property);
assert.equal(storedRow.city, "Lantana", "write mapping stores the free-form city");
const reopened = propertyFromRow(storedRow);
assert.equal(reopened.city, "Lantana", "read mapping preserves the stored city when reopened");

assert.equal(validatePropertyWriteIdentity({ id: "x", name: "Test", city: "" }).ok, false);
assert.equal(validatePropertyWriteIdentity({ id: "x", name: "Test", city: 123 }).ok, false);

console.log("Add Property free-form city flow: PASS");
