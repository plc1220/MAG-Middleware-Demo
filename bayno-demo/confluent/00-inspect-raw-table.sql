-- Confluent Flink automatically infers a table for every Kafka topic.
-- The existing raw topic has a BYTES key and BYTES value; the insert casts
-- `val` to STRING before splitting its pipe-delimited fields.
SHOW CREATE TABLE mag_bayno_raw;
