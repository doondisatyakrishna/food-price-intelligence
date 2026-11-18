import os
from sqlalchemy import Column, Date, Float, ForeignKey, Integer, String, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker

Base = declarative_base()


class Market(Base):
  __tablename__ = "markets"

  id = Column(Integer, primary_key=True, autoincrement=True)
  name = Column(String(100), nullable=False)
  district = Column(String(100), nullable=False)
  state = Column(String(50), nullable=False)


class Commodity(Base):
  __tablename__ = "commodities"

  id = Column(Integer, primary_key=True, autoincrement=True)
  name = Column(String(100), nullable=False, unique=True)
  category = Column(String(50))


class DailyPrice(Base):
  __tablename__ = "daily_prices"

  id = Column(Integer, primary_key=True, autoincrement=True)
  market_id = Column(Integer, ForeignKey("markets.id"), nullable=False)
  commodity_id = Column(Integer, ForeignKey("commodities.id"), nullable=False)
  date = Column(Date, nullable=False)
  modal_price_inr = Column(Float, nullable=False)
  min_price_inr = Column(Float)
  max_price_inr = Column(Float)


class WeatherData(Base):
  __tablename__ = "weather_data"

  id = Column(Integer, primary_key=True, autoincrement=True)
  region_name = Column(String(100), nullable=False)
  date = Column(Date, nullable=False)
  temperature_max_c = Column(Float)
  temperature_min_c = Column(Float)
  precipitation_mm = Column(Float)


def init_db(db_url="sqlite:///data/food_price_intelligence.db"):
  # Ensures the data directory exists if running from root
  os.makedirs("data", exist_ok=True)
  engine = create_engine(db_url)
  Base.metadata.create_all(engine)
  Session = sessionmaker(bind=engine)
  return Session()